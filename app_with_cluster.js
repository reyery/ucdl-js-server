const express = require('express')
const cors = require('cors')
const generate = require("./simulations/sim_generate").execute;
const Shape = require('@doodle3d/clipper-js').default;
const path = require('path');

const shapefile = require("shapefile");
const proj4 = require('proj4');
const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');
const { exec } = require("child_process");
const { sg_wind_stn_data } = require('./simulations/sg_wind_station_data');
const { Piscina } = require('piscina');
const { config } = require('./simulations/const');

const cluster = require("cluster");
const os = require('os');

// const systemCpuCores = os.cpus();
const POOL_SETTINGS = {
  // minThreads: 5,
  maxThreads: 64,
  idleTimeout: 60000
}
let POOL = new Piscina(POOL_SETTINGS)
const TILES_PER_WORKER = 500

if (cluster.isMaster) {
  // Fork workers.
  for (let i = 0; i < 3; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
    console.log("Let's fork another worker!");
    cluster.fork();
  });
} else {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  if (!fs.existsSync('temp')) {
    fs.mkdirSync('temp')
  }
  const port = 5202

  const bound = [
    [
      103.84603534265634,
      1.283583459888149
    ],
    [
      103.84683338174219,
      1.2850590292996458
    ],
    [
      103.84821493326024,
      1.284265481937453
    ],
    [
      103.84738686057385,
      1.2828370962610478
    ]
  ]

  const LONGLAT = [103.778329, 1.298759];
  const TILE_SIZE = 500;
  const RESOURCE_LIM_DICT = {
    10: 40,
    5: 60,
    2: 128,
    1: 128
  }
  const SIM_DISTANCE_LIMIT_METER = 300
  const SIM_DISTANCE_LIMIT_LATLONG = SIM_DISTANCE_LIMIT_METER / 111111

  function _createProjection() {
    // create the function for transformation
    const proj_str_a = '+proj=tmerc +lat_0=';
    const proj_str_b = ' +lon_0=';
    const proj_str_c = '+k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs';
    let longitude = LONGLAT[0];
    let latitude = LONGLAT[1];
    const proj_from_str = 'WGS84';
    const proj_to_str = proj_str_a + latitude + proj_str_b + longitude + proj_str_c;
    const proj_obj = proj4(proj_from_str, proj_to_str);
    return proj_obj;
  }
  const proj_obj = _createProjection()


  function getSession() {
    return 's' + (new Date()).getTime()
  }

  function fillString(x) {
    if (x < 0) {
      const s = x.toString()
      return '-' + ('00000' + s.slice(1)).slice(s.length - 1)
    }
    const s = x.toString()
    return ('00000' + s).slice(s.length)
  }




  async function runJSSimulation(reqBody, simulationType, reqSession = null) {
    const session = reqSession ? reqSession : getSession()
    const boundary = reqBody.bounds
    const gridSize = reqBody.gridSize
    let processLimit = RESOURCE_LIM_DICT[gridSize]
    const otherInfo = {}
    const limCoords = [99999, 99999, -99999, -99999];
    const limExt = [999, 999, -999, -999];
    const coords = []
    for (const latlong of boundary) {
      const coord = [...proj_obj.forward(latlong), 0]
      limCoords[0] = Math.min(coord[0], limCoords[0])
      limCoords[1] = Math.min(coord[1], limCoords[1])
      limCoords[2] = Math.max(coord[0], limCoords[2])
      limCoords[3] = Math.max(coord[1], limCoords[3])
      limExt[0] = Math.min(latlong[0], limExt[0])
      limExt[1] = Math.min(latlong[1], limExt[1])
      limExt[2] = Math.max(latlong[0], limExt[2])
      limExt[3] = Math.max(latlong[1], limExt[3])
      coords.push(coord)
    }

    const mfn = new SIMFuncs();
    const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

    limExt[0] -= SIM_DISTANCE_LIMIT_LATLONG,
      limExt[1] -= SIM_DISTANCE_LIMIT_LATLONG,
      limExt[0] += SIM_DISTANCE_LIMIT_LATLONG,
      limExt[1] += SIM_DISTANCE_LIMIT_LATLONG,

      console.log('limExt', limExt)
    // const surroundingBlks = []
    const basePgons = []
    while (true) {
      const result = await shpFile.read()
      if (!result || result.done) { break; }

      let check = false
      let dataCoord = result.value.geometry.coordinates[0]
      if (dataCoord[0][0] && typeof dataCoord[0][0] !== 'number') {
        dataCoord = dataCoord[0]
      }
      for (const c of dataCoord) {
        if (c[0] < limExt[0] || c[1] < limExt[1] || c[0] > limExt[2] || c[1] > limExt[3]) {
        } else {
          check = true
          break
        }
      }
      if (!check) { continue }
      const pos = []
      for (const c of dataCoord) {
        const nc = proj_obj.forward(c)
        nc.push(0)
        pos.push(nc)
      }

      const ps = mfn.make.Position(pos)
      const pg = mfn.make.Polygon(ps)
      mfn.make.Extrude(pg, result.value.properties.AGL, 1, 'quads')
      basePgons.push(pg)
    }
    mfn.edit.Delete(basePgons, 'delete_selected')
    const allObstructions = mfn.query.Get('pg', null)
    mfn.attrib.Set(allObstructions, 'cluster', 1)
    mfn.attrib.Set(allObstructions, 'type', 'obstruction')
    mfn.attrib.Set(allObstructions, 'obstruction', true)
    mfn.io.Geolocate([config["latitude"], config["longitude"]], 0, 0);

    console.log('limCoords', limCoords)
    console.log('coords', coords)
    console.log('width, height', limCoords[3] - limCoords[1], limCoords[2] - limCoords[0])
    console.log('rows, cols', (limCoords[3] - limCoords[1]) / gridSize, (limCoords[2] - limCoords[0]) / gridSize)
    const rows = Math.ceil((limCoords[3] - limCoords[1]) / gridSize)
    const cols = Math.ceil((limCoords[2] - limCoords[0]) / gridSize)
    const total = rows * cols
    if (total < processLimit * 10) {
      processLimit = Math.floor(total / 10)
    } else if (processLimit < total / 10000) {
      processLimit = Math.ceil(total / 10000)
    }
    const numCoordsPerThread = Math.ceil(total / processLimit)
    console.log('rows, cols', rows, cols)
    console.log('processLimit', processLimit)
    console.log('numCoordsPerThread', numCoordsPerThread)

    const options_gen = { filename: path.resolve("./", 'simulations/check_sim_area.js') }
    const options_ex = { filename: path.resolve("./", 'simulations/sim_execute.js') }
    let queues = []

    for (let i = 0; i < processLimit; i++) {
      const startNum = numCoordsPerThread * i
      let endNum = numCoordsPerThread * (i + 1)
      if (endNum > total) { endNum = total; }
      const simCoords = []
      for (let j = startNum; j < endNum; j++) {
        const offsetX = j % cols
        const offsetY = Math.floor(j / cols)
        simCoords.push([limCoords[0] + offsetX * gridSize, limCoords[1] + offsetY * gridSize])
      }
      if (simCoords.length === 0) { continue }
      console.log(simCoords[0], simCoords[simCoords.length - 1])
      queues.push(`${JSON.stringify(coords)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}`)
    }
    const gen_result_queues = []
    await Promise.all(queues.map(x => gen_result_queues.push(POOL.run(x, options_gen))))
    let gen_result = []
    let gen_result_index = []
    for (const result_promise of gen_result_queues) {
      const r = await result_promise
      gen_result = gen_result.concat(r[0])
      gen_result_index = gen_result_index.concat(r[1])
    }

    queues = []

    fs.mkdirSync('temp/' + session)
    const obsFile = 'temp/' + session + '/file_' + session + '.sim'
    console.log('writing file: file_' + session + '.sim')
    fs.writeFileSync(obsFile, await mfn.io.ExportData(null, 'sim'))
    console.log('finished writing file')
    const pgons = mfn.query.Get('pg', null);
    mfn.edit.Delete(pgons, 'delete_selected');
    delete mfn

    console.log('gen_result.length', gen_result.length)
    if (gen_result.length < (processLimit * 10)) {
      processLimit = Math.floor(gen_result.length / 10)
    } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
      processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
    }
    for (let i = 0; i < processLimit; i++) {
      const fromIndex = Math.ceil(gen_result.length / processLimit) * i
      let toIndex = Math.ceil(gen_result.length / processLimit) * (i + 1)
      if (fromIndex >= gen_result.length) {
        processLimit = i
        break
      }
      if (toIndex >= gen_result.length) { toIndex = gen_result.length }
      const genFile = `temp/${session}/file_${session}_${i}`
      const threadCoords = gen_result.slice(fromIndex, toIndex)
      fs.writeFileSync(genFile, JSON.stringify(threadCoords))
      queues.push(`${simulationType} ${obsFile} ${genFile} ${gridSize}`)
    }
    await Promise.all(queues.map(x => POOL.run(x, options_ex)))
    if (simulationType === 'wind') {
      const wind_stns = new Set()
      for (let i = 0; i < processLimit; i++) {
        const wind_stn_file = `temp/${session}/file_${session}_${i}_wind_stns.txt`
        if (fs.existsSync(wind_stn_file)) {
          const wind_stns_used = fs.readFileSync(wind_stn_file, { encoding: 'utf8', flag: 'r' })
          for (const stn of wind_stns_used.split(',')) {
            wind_stns.add(stn.trim())
          }
        }
      }
      otherInfo.wind_stns = Array.from(wind_stns)
    }
    let compiledResult = []
    for (let i = 0; i < processLimit; i++) {
      try {
        const readfile = `temp/${session}/file_${session}_${i}.txt`
        const fileresult = fs.readFileSync(readfile, { encoding: 'utf8', flag: 'r' })
        compiledResult.push(fileresult)
        fs.unlinkSync(readfile)
      } catch (ex) {
        console.log('!!ERROR!! at index', i)
        console.log('!!ERROR!!:', ex)
      }
    }
    console.log('deleting file: file_' + session + '.sim')
    fs.rmSync('temp/' + session, { recursive: true, force: true });
    const fullResult = JSON.parse('[' + compiledResult.join(', \n') + ']')
    console.log(fullResult.length)
    return [fullResult, gen_result_index, [cols, rows], otherInfo]
  }

  function logTime(starttime, simType, otherInfo = '') {
    const duration = Math.round((new Date() - starttime) / 1000)
    if (duration > 60) {
      const min = Math.floor(duration / 60)
      const sec = duration % 60
      fs.appendFileSync('log.txt', `${starttime.toLocaleString()}: ${otherInfo} - ${simType} ${min}m${sec}s\n`)
      return `${min}m${sec}s`
    } else {
      fs.appendFileSync('log.txt', `${starttime.toLocaleString()}: ${otherInfo} - ${simType} ${duration}s\n`)
      return ` ${duration}s`
    }
  }

  app.post('/solar', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, _] = await runJSSimulation(req.body, 'solar', session = req.body.session)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'solar', origin)

      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })
  app.post('/sky', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, _] = await runJSSimulation(req.body, 'sky', session = req.body.session)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'sky', origin)
      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })
  app.post('/wind', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, otherInfo] = await runJSSimulation(req.body, 'wind', session = req.body.session)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'wind', origin)
      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        wind_stns: otherInfo.wind_stns,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })

  app.post('/getAreaInfo', async (req, res) => {
    try {
      const starttime = new Date()
      const bounds = req.body.bounds
      const ext = bounds.reduce((ext, val) => {
        console.log(val)
        ext[0] = Math.min(ext[0], val[0])
        ext[1] = Math.min(ext[1], val[1])
        ext[2] = Math.max(ext[2], val[0])
        ext[3] = Math.max(ext[3], val[1])
        return ext
      }, [10000, 10000, -10000, -10000])
      ext[0] = ext[0] - 0.0045
      ext[1] = ext[1] - 0.0045
      ext[2] = ext[2] + 0.0045
      ext[3] = ext[3] + 0.0045

      const boundClipper = new Shape([bounds.map(coord => { return { X: coord[0] * 111139, Y: coord[1] * 111139 } })])
      boundClipper.fixOrientation()
      console.log(boundClipper.totalArea())

      const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

      let count = 0
      let shpArea = 0
      while (true) {
        const result = await shpFile.read()
        if (!result || result.done) { break; }
        // if (!result.value.properties.AGL || result.value.properties.AGL < 1) {
        //     console.log(result.value)
        //     continue
        // }
        let c = result.value.geometry.coordinates[0][0]
        while (c.length > 2) {
          c = c[0]
        }
        if (c[0] < ext[0] || c[1] < ext[1] || c[0] > ext[2] || c[1] > ext[3]) { continue }
        count += 1
        const shpBound = result.value.geometry.coordinates

        const shp = new Shape(shpBound.map(bound => bound.map(coord => {
          return { X: coord[0] * 111139, Y: coord[1] * 111139 }
        })))
        shp.fixOrientation()
        const ints = boundClipper.intersect(shp)
        shpArea += ints.totalArea()

        console.log(shp.areas())


        // const xy = proj_obj.forward(c);
        // const floor_xy = xy.map(x => Math.floor(x / TILE_SIZE)  * TILE_SIZE)
        // for (let i = -1; i <= 1; i++) {
        //     for (let j = -1; j <= 1; j++) {
        //         const coord = (floor_xy[0] + i * TILE_SIZE) + '__' + (floor_xy[1] + j * TILE_SIZE) 
        //         if (!geom[coord]) { 
        //             geom[coord] = []
        //         }
        //     }
        // }
        // geom[floor_xy.join('__')].push(result.value)
      }
      console.log(boundClipper.totalArea())
      console.log(shpArea)

      res.send({
        result: 'OK'
      })
      // const origin = req.socket.remoteAddress;
      // logTime(starttime, 'getInfo', origin)
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })

  app.post('/check_progress', async (req, res) => {
    // try {
    //   const filePrefix = 'temp/' + req.body.session  + '/file_' + req.body.session + '.sim'
    //   console.log('checking progress of', filePrefix)
    //   progress = [0, 0]
    //   for (let i = 0; i < PROCESS_LIMIT; i++) {
    //     try {
    //       const fileresult = fs.readFileSync(filePrefix + '_' + index + '_progress', {encoding:'utf8', flag:'r'})
    //       if (fileresult) {
    //         data = fileresult.split(' ').map(x => Number(x))
    //         progress[0] += data[0]
    //         progress[1] += data[1]
    //       }
    //     } catch (ex) {
    //       console.log('!!ERROR!! at index', i)
    //       console.log('!!ERROR!!:', ex)
    //     }
    //   }
    //   if (progress[1] === 0) {
    //     res.send({
    //       progress: 0
    //     })
    //     return
    //   }
    //   res.send({
    //     progress: Math.round(progress[0] / progress[1] * 1000) / 10
    //   })

    //   return
    // } catch (ex) {
    //   console.log('ERROR', ex)
    // }

    res.send({
      progress: 0
    })
  })


  async function runUploadJSSimulation(reqBody, simulationType, reqSession = null) {
    const session = reqSession ? reqSession : getSession()
    const { extent, data, simBoundary, featureBoundary, gridSize } = reqBody
    let processLimit = RESOURCE_LIM_DICT[gridSize]
    const otherInfo = {}
    const boundClipper = new Shape([featureBoundary.map(coord => { return { X: coord[0] * 1000000, Y: coord[1] * 1000000 } })])
    boundClipper.fixOrientation()
    console.log('boundClipper', boundClipper, boundClipper.totalArea())

    const mfn = new SIMFuncs();
    await mfn.io.ImportData(data, 'sim');

    const allObstructions = mfn.query.Get('pg', null)
    mfn.attrib.Set(allObstructions, 'cluster', 1)
    mfn.attrib.Set(allObstructions, 'type', 'obstruction')
    mfn.attrib.Set(allObstructions, 'obstruction', true)

    const limCoords = [99999, 99999, -99999, -99999];
    const boundExt = [99999, 99999, -99999, -99999];
    const featrExt = [99999, 99999, -99999, -99999];
    const coords = []
    for (const latlong of simBoundary) {
      const coord = [...proj_obj.forward(latlong), 0]
      limCoords[0] = Math.min(coord[0], limCoords[0])
      limCoords[1] = Math.min(coord[1], limCoords[1])
      limCoords[2] = Math.max(coord[0], limCoords[2])
      limCoords[3] = Math.max(coord[1], limCoords[3])
      boundExt[0] = Math.min(latlong[0], boundExt[0])
      boundExt[1] = Math.min(latlong[1], boundExt[1])
      boundExt[2] = Math.max(latlong[0], boundExt[2])
      boundExt[3] = Math.max(latlong[1], boundExt[3])
      coords.push(coord)
    }
    for (const latlong of featureBoundary) {
      featrExt[0] = Math.min(latlong[0], featrExt[0])
      featrExt[1] = Math.min(latlong[1], featrExt[1])
      featrExt[2] = Math.max(latlong[0], featrExt[2])
      featrExt[3] = Math.max(latlong[1], featrExt[3])
    }

    // const pos = mfn.make.Position(coords)
    // const pgon = mfn.make.Polygon(pos)
    // mfn.attrib.Set(pgon, 'type', 'site')
    // mfn.attrib.Set(pgon, 'cluster', 0)

    // add buildings from shape file

    const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

    const limExt = [
      boundExt[0] - SIM_DISTANCE_LIMIT_LATLONG,
      boundExt[1] - SIM_DISTANCE_LIMIT_LATLONG,
      boundExt[2] + SIM_DISTANCE_LIMIT_LATLONG,
      boundExt[3] + SIM_DISTANCE_LIMIT_LATLONG,
    ]
    const surroundingBlks = []
    while (true) {
      const result = await shpFile.read()
      if (!result || result.done) { break; }

      let check = false
      let dataCoord = result.value.geometry.coordinates[0]
      if (dataCoord[0][0] && typeof dataCoord[0][0] !== 'number') {
        dataCoord = dataCoord[0]
      }
      for (const c of dataCoord) {
        // if (c[0] > featrExt[0] && c[1] > featrExt[1] && c[0] < featrExt[2] && c[1] < featrExt[3]) {
        //   const coordShape = new Shape([dataCoord.map(coord => {return {X: coord[0] * 1000000, Y: coord[1] * 1000000}})])
        //   coordShape.fixOrientation()
        //   const intersection = coordShape.intersect(boundClipper)
        //   if (intersection.paths.length > 0) { check = false } else { check = true }
        //   break
        // }  
        if (c[0] < limExt[0] || c[1] < limExt[1] || c[0] > limExt[2] || c[1] > limExt[3]) {
        } else {
          const coordShape = new Shape([dataCoord.map(coord => { return { X: coord[0] * 1000000, Y: coord[1] * 1000000 } })])
          coordShape.fixOrientation()
          const intersection = coordShape.intersect(boundClipper)
          if (intersection.paths.length > 0) { check = false } else { check = true }
          break
          // check = true
          // break
        }
      }
      if (!check) { continue }
      const pos = []
      for (const c of dataCoord) {
        const nc = proj_obj.forward(c)
        nc.push(0)
        pos.push(nc)
      }

      const ps = mfn.make.Position(pos)
      const pg = mfn.make.Polygon(ps)
      const pgons = mfn.make.Extrude(pg, result.value.properties.AGL, 1, 'quads')
      mfn.attrib.Set(pgons, 'cluster', 1)
      mfn.attrib.Set(pgons, 'type', 'obstruction')
      mfn.attrib.Set(pgons, 'obstruction', true)

      surroundingBlks.push({
        coord: pos,
        height: result.value.properties.AGL
      })
    }
    mfn.io.Geolocate([config["latitude"], config["longitude"]], 0, 0);

    console.log('limCoords', limCoords)
    console.log('coords', coords)
    console.log('width, height', limCoords[3] - limCoords[1], limCoords[2] - limCoords[0])
    console.log('rows, cols', (limCoords[3] - limCoords[1]) / gridSize, (limCoords[2] - limCoords[0]) / gridSize)
    const rows = Math.ceil((limCoords[3] - limCoords[1]) / gridSize)
    const cols = Math.ceil((limCoords[2] - limCoords[0]) / gridSize)
    const total = rows * cols
    if (total < processLimit * 10) {
      processLimit = Math.floor(total / 10)
    } else if (processLimit < total / 10000) {
      processLimit = Math.ceil(total / 10000)
    }
    const numCoordsPerThread = Math.ceil(total / processLimit)
    console.log('rows, cols', rows, cols)
    console.log('processLimit', processLimit)
    console.log('numCoordsPerThread', numCoordsPerThread)

    const options_gen = { filename: path.resolve("./", 'simulations/check_sim_area.js') }
    const options_ex = { filename: path.resolve("./", 'simulations/sim_execute.js') }
    let queues = []

    for (let i = 0; i < processLimit; i++) {
      const startNum = numCoordsPerThread * i
      let endNum = numCoordsPerThread * (i + 1)
      if (endNum > total) { endNum = total; }
      const simCoords = []
      for (let j = startNum; j < endNum; j++) {
        const offsetX = j % cols
        const offsetY = Math.floor(j / cols)
        simCoords.push([limCoords[0] + offsetX * gridSize, limCoords[1] + offsetY * gridSize])
      }
      if (simCoords.length === 0) { continue }
      console.log(simCoords[0], simCoords[simCoords.length - 1])
      queues.push(`${JSON.stringify(coords)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}`)
    }
    const gen_result_queues = []
    await Promise.all(queues.map(x => gen_result_queues.push(POOL.run(x, options_gen))))
    let gen_result = []
    let gen_result_index = []
    for (const result_promise of gen_result_queues) {
      const r = await result_promise
      gen_result = gen_result.concat(r[0])
      gen_result_index = gen_result_index.concat(r[1])
    }

    queues = []

    fs.mkdirSync('temp/' + session)
    const obsFile = 'temp/' + session + '/file_' + session + '.sim'
    console.log('writing file: file_' + session + '.sim')
    fs.writeFileSync(obsFile, await mfn.io.ExportData(null, 'sim'))
    console.log('finished writing file')
    const pgons = mfn.query.Get('pg', null);
    mfn.edit.Delete(pgons, 'delete_selected');
    delete mfn

    console.log('gen_result.length', gen_result.length)
    if (gen_result.length < (processLimit * 10)) {
      processLimit = Math.floor(gen_result.length / 10)
    } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
      processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
    }
    for (let i = 0; i < processLimit; i++) {
      const fromIndex = Math.ceil(gen_result.length / processLimit) * i
      let toIndex = Math.ceil(gen_result.length / processLimit) * (i + 1)
      if (fromIndex >= gen_result.length) { break }
      if (toIndex >= gen_result.length) { toIndex = gen_result.length }
      const genFile = `temp/${session}/file_${session}_${i}`
      const threadCoords = gen_result.slice(fromIndex, toIndex)
      fs.writeFileSync(genFile, JSON.stringify(threadCoords))
      queues.push(`${simulationType} ${obsFile} ${genFile} ${gridSize}`)
    }
    await Promise.all(queues.map(x => POOL.run(x, options_ex)))
    if (simulationType === 'wind') {
      const wind_stns = new Set()
      for (let i = 0; i < processLimit; i++) {
        const wind_stn_file = `temp/${session}/file_${session}_${i}_wind_stns.txt`
        if (fs.existsSync(wind_stn_file)) {
          const wind_stns_used = fs.readFileSync(wind_stn_file, { encoding: 'utf8', flag: 'r' })
          for (const stn of wind_stns_used.split(',')) {
            wind_stns.add(stn.trim())
          }
        }
      }
      otherInfo.wind_stns = Array.from(wind_stns)
    }
    let compiledResult = []
    for (let i = 0; i < processLimit; i++) {
      try {
        const readfile = `temp/${session}/file_${session}_${i}.txt`
        const fileresult = fs.readFileSync(readfile, { encoding: 'utf8', flag: 'r' })
        compiledResult.push(fileresult)
        fs.unlinkSync(readfile)
      } catch (ex) {
        console.log('!!ERROR!! at index', i)
        console.log('!!ERROR!!:', ex)
      }
    }
    console.log('deleting file: file_' + session + '.sim')
    fs.rmSync('temp/' + session, { recursive: true, force: true });
    const fullResult = JSON.parse('[' + compiledResult.join(', \n') + ']')
    console.log(fullResult.length)
    return [fullResult, gen_result_index, [cols, rows], surroundingBlks, otherInfo]


    // const gen = await generate(mfn, gridSize)
    // if (!fs.existsSync('temp/' + session)) {
    //   fs.mkdirSync('temp/' + session)
    // }
    // const genFile = 'temp/' + session + '/file_' + session + '.sim'
    // console.log('writing file: file_' + session + '.sim')
    // fs.writeFileSync(genFile, gen)
    // console.log('finished writing file')
    // const pgons = mfn.query.Get('pg', null);
    // mfn.edit.Delete(pgons, 'delete_selected');
    // delete mfn
    // delete gen

    // let closest_stn = {id: 'S24', dist2: null}
    // if (simulationType === 'wind') {
    //   for (const stn of sg_wind_stn_data) {
    //       const distx = stn.coord[0] - bBox[0][0]
    //       const disty = stn.coord[1] - bBox[0][1]
    //       const dist2 = distx * distx + disty * disty
    //       if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
    //           closest_stn.id = stn.id
    //           closest_stn.dist2 = dist2
    //       }
    //   }
    // }


    // console.log('start running!!')

    // const options = {filename: path.resolve("./", 'simulations/sim_execute.js')}
    // const queues = []
    // for (let i = 0; i < processLimit; i++) {
    //   queues.push(`${simulationType} ${genFile} ${i} ${processLimit} ${closest_stn.id}`)
    // }
    // await Promise.all(queues.map(x => POOL.run(x, options)))

    // if (simulationType === 'wind') {
    //   const wind_stns = new Set()
    //   for (let i = 0; i < processLimit; i++) {
    //     const wind_stn_file = `${genFile}_${i}_wind_stns.txt`
    //     if (fs.existsSync(wind_stn_file)) {
    //       const wind_stns_used = fs.readFileSync(wind_stn_file, {encoding:'utf8', flag:'r'})
    //       for (const stn of wind_stns_used.split(',')) {
    //         wind_stns.add(stn.trim())
    //       }
    //     }
    //   }
    //   otherInfo.wind_stns = Array.from(wind_stns)
    // }
    // let compiledResult = []
    // for (let i = 0; i < processLimit; i++) {
    //   try {
    //     const readfile = `${genFile}_${i}.txt`
    //     const fileresult = fs.readFileSync(readfile, {encoding:'utf8', flag:'r'})
    //     compiledResult.push(fileresult)
    //     fs.unlinkSync(readfile)
    //   } catch (ex) {
    //     console.log('!!ERROR!! at index', i)
    //     console.log('!!ERROR!!:', ex)
    //   }
    // }
    // console.log('deleting file: file_' + session + '.sim')
    // fs.rmSync('temp/' + session, { recursive: true, force: true });
    // const fullResult = JSON.parse('[' + compiledResult.join(', \n') + ']')
    // return [fullResult, surroundingBlks, otherInfo]
  }

  app.post('/solar_upload', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, surrounding, _] = await runUploadJSSimulation(req.body, 'solar', session = req.body.session)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'solar', origin)
      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        surrounding: surrounding,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })

  app.post('/sky_upload', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, surrounding, _] = await runUploadJSSimulation(req.body, 'sky', session = req.body.session, gridSize = 10)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'sky', origin)
      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        surrounding: surrounding,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })
  app.post('/wind_upload', async (req, res) => {
    try {
      const starttime = new Date()
      const [result, resultIndex, dimension, surrounding, otherInfo] = await runUploadJSSimulation(req.body, 'wind', session = req.body.session)
      const origin = req.socket.remoteAddress;
      const runtime = logTime(starttime, 'wind', origin)
      res.send({
        result: result,
        resultIndex: resultIndex,
        dimension: dimension,
        surrounding: surrounding,
        wind_stns: otherInfo.wind_stns,
        runtime: runtime
      })
      return
    } catch (ex) {
      console.log('ERROR', ex)
    }

    res.status(200).send({
      result: null
    })
  })

  app.listen(port, '0.0.0.0', () => {
    console.log(`Example app listening on port ${port}`)
  })
}


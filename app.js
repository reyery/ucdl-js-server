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


const app = express()
app.use(cors())
app.use(express.json({limit: '10mb'}))

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
const config = {
  "latitude": 1.298759,
  "longitude": 103.778329,
  "g_solar_min": 0,
  "g_solar_max": 50,
  "g_sky_min": 50,
  "g_sky_max": 100,
  "g_uhi_min": 0,
  "g_uhi_max": 4,
  "g_wind_min": 60,
  "g_wind_max": 100,
  "g_irr_min": 0,
  "g_irr_max": 800,
  "g_irr_rad_min": 0,
  "g_irr_rad_max": 800,
  "f_solar_min": 0,
  "f_solar_max": 50,
  "f_sky_min": 50,
  "f_sky_max": 100,
  "f_irr_min": 0,
  "f_irr_max": 500,
  "f_irr_rad_min": 0,
  "f_irr_rad_max": 500,
  "f_noise_min": 0,
  "f_noise_max": 60,
  "f_unob_min": 80,
  "f_unob_max": 100,
  "f_visib_min": 0,
  "f_visib_max": 60,
}
const PROCESS_LIMIT = 20
const SIM_DISTANCE_LIMIT_METER =  200
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




async function runJSSimulation(boundary, simulationType, reqSession=null) {

  const session = reqSession? reqSession : getSession()
  const otherInfo = {}
  // const minCoord = [99999, 99999];
  // const maxCoord = [-99999, -99999];
  const limExt = [999, 999, -999, -999];
  const coords = []
  for (const latlong of boundary) {
    const coord = [...proj_obj.forward(latlong), 0]
    // minCoord[0] = Math.min(coord[0], minCoord[0])
    // minCoord[1] = Math.min(coord[1], minCoord[1])
    // maxCoord[0] = Math.max(coord[0], maxCoord[0])
    // maxCoord[1] = Math.max(coord[1], maxCoord[1])
    limExt[0] = Math.min(latlong[0], limExt[0])
    limExt[1] = Math.min(latlong[1], limExt[1])
    limExt[2] = Math.max(latlong[0], limExt[2])
    limExt[3] = Math.max(latlong[1], limExt[3])
    coords.push(coord)
  }

  console.log('coords', coords)

  const mfn = new SIMFuncs();
  const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

  limExt[0] -= SIM_DISTANCE_LIMIT_LATLONG,
  limExt[1] -= SIM_DISTANCE_LIMIT_LATLONG,
  limExt[0] += SIM_DISTANCE_LIMIT_LATLONG,
  limExt[1] += SIM_DISTANCE_LIMIT_LATLONG,

  console.log('limExt', limExt)
  // const surroundingBlks = []
  while (true) {
    const result = await shpFile.read()
    if (!result || result.done) { break; }

    let check = false
    let dataCoord = result.value.geometry.coordinates[0]
    if (dataCoord[0][0] && typeof dataCoord[0][0] !== 'number'){
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
    const pgons = mfn.make.Extrude(pg, result.value.properties.AGL, 1, 'quads')
    mfn.attrib.Set(pgons, 'cluster', 1)
    mfn.attrib.Set(pgons, 'type', 'obstruction')
    mfn.attrib.Set(pgons, 'obstruction', true)

    // surroundingBlks.push({
    //   coord: pos,
    //   height: result.value.properties.AGL
    // })
  }

  // const promises = []
  // for (let i = Math.floor(minCoord[0] / TILE_SIZE) - 1; i <= Math.floor(maxCoord[0] / TILE_SIZE) + 1; i++) {
  //   for (let j = Math.floor(minCoord[1] / TILE_SIZE) - 1; j <= Math.floor(maxCoord[1] / TILE_SIZE) + 1; j++) {
  //     const p = new Promise(resolve => fs.readFile(process.cwd() + '/assets/models/data_' +
  //       fillString(i * TILE_SIZE) + '_' + fillString(j * TILE_SIZE) +
  //       '.sim', 'utf8', (err, data) => {
  //         if (err) {
  //           console.log('ERROR', err)
  //           resolve(null)
  //           return null
  //         }
  //         resolve(data)
  //       }))
  //     promises.push(p)
  //   }
  // }

  // await Promise.all(promises)
  // for (const promise of promises) {
  //   const model = await promise
  //   if (model) {
  //     await mfn.io.Import(model, 'sim');
  //   }
  // }
  const allObstructions = mfn.query.Get('pg', null)
  mfn.attrib.Set(allObstructions, 'cluster', 1)
  mfn.attrib.Set(allObstructions, 'type', 'obstruction')
  mfn.attrib.Set(allObstructions, 'obstruction', true)

  const pos = mfn.make.Position(coords)
  const pgon = mfn.make.Polygon(pos)
  mfn.attrib.Set(pgon, 'type', 'site')
  mfn.attrib.Set(pgon, 'cluster', 0)

  const gen = await generate(mfn, config)
  fs.mkdirSync('temp/' + session)
  const genFile = 'temp/' + session + '/file_' + session + '.sim'
  console.log('writing file: file_' + session + '.sim')
  fs.writeFileSync(genFile, gen)

  let closest_stn = {id: 'S24', dist2: null}
  if (simulationType === 'wind') {
    for (const stn of sg_wind_stn_data) {
        const distx = stn.coord[0] - coords[0][0]
        const disty = stn.coord[1] - coords[0][1]
        const dist2 = distx * distx + disty * disty
        if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
            closest_stn.id = stn.id
            closest_stn.dist2 = dist2
        }
    }
  }
  const pool = new Piscina()
  const options = {filename: path.resolve("./", 'simulations/sim_execute.js')}
  const queues = []
  for (let i = 0; i < PROCESS_LIMIT; i++) {
    queues.push(`${simulationType} ${genFile} ${i} ${PROCESS_LIMIT} ${closest_stn.id}`)
  }
  await Promise.all(queues.map(x => pool.run(x, options)))

  // const queues = []
  // for (let i = 0; i < PROCESS_LIMIT; i++) {
  //   const p = new Promise((resolve, reject) => {
  //     try {
  //       exec(`node simulations/sim_execute ${simulationType} ${genFile} ${i} ${PROCESS_LIMIT} ${closest_stn.id}`,
  //         (error, stdout, stderr) => {
  //           if (error) {
  //             console.log(`error: ${simulationType} ${i}\n`)
  //             console.log(error)
  //             // fs.appendFileSync('genScript/log.txt', `error: ${type} ${file}\n`, function (err) {
  //             //   if (err) throw err;
  //             // });
  //             reject(error);
  //             return;
  //           }
  //           resolve(stdout)
  //         })
  //     } catch (ex) {
  //       console.log(`error: ${simulationType} ${i}\n`)
  //       console.log(ex)
  //       // fs.appendFileSync('genScript/log.txt', `error: ${type} ${file}\n`, function (err) {
  //       //   if (err) throw err;
  //       // });
  //     }
  //   })
  //   queues.push(p)
  // }
  // await Promise.all(queues)

  if (simulationType === 'wind') {
    const wind_stns = new Set()
    for (let i = 0; i < PROCESS_LIMIT; i++) {
      const wind_stn_file = `${genFile}_${i}_wind_stns.txt`
      if (fs.existsSync(wind_stn_file)) {
        const wind_stns_used = fs.readFileSync(wind_stn_file, {encoding:'utf8', flag:'r'})
        for (const stn of wind_stns_used.split(',')) {
          wind_stns.add(stn.trim())
        }
      }
    }
    otherInfo.wind_stns = Array.from(wind_stns)
  }
  let compiledResult = []
  for (let i = 0; i < PROCESS_LIMIT; i++) {
    try {
      const readfile = `${genFile}_${i}.txt`
      const fileresult = fs.readFileSync(readfile, {encoding:'utf8', flag:'r'})
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
  return [fullResult, otherInfo]
}

function logTime(starttime, simType, otherInfo = '') {
  const duration = Math.round((new Date() - starttime) / 1000)
  if (duration > 60) {
    const min = Math.floor(duration / 60)
    const sec = duration % 60
    fs.appendFileSync('log.txt', `${starttime.toLocaleString()}: ${otherInfo} - ${simType} ${min}m${sec}s\n`)
  } else {
    fs.appendFileSync('log.txt', `${starttime.toLocaleString()}: ${otherInfo} - ${simType} ${duration}s\n`)
  }
}

app.post('/solar', async (req, res) => {
  try {
    const starttime = new Date()
    const [result, _] = await runJSSimulation(req.body.bounds, 'solar', session=req.body.session)
    res.send({
      result: result
    })
    const origin = req.socket.remoteAddress;

    logTime(starttime, 'solar', origin)
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
    const [result, _] = await runJSSimulation(req.body.bounds, 'sky', session=req.body.session)
    res.send({
      result: result
    })
    const origin = req.socket.remoteAddress;

    logTime(starttime, 'solar', origin)
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
    const [result, otherInfo] = await runJSSimulation(req.body.bounds, 'wind', session=req.body.session)
    res.send({
      result: result,
      wind_stns: otherInfo.wind_stns
    })
    const origin = req.socket.remoteAddress;
    logTime(starttime, 'wind', origin)
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

    const boundClipper = new Shape([bounds.map(coord => {return {X: coord[0] * 111139, Y: coord[1] * 111139}})])
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
        return {X: coord[0] * 111139, Y: coord[1] * 111139}
      })))
      shp.fixOrientation()
      const ints = boundClipper.intersect( shp )
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
  try {
    const filePrefix = 'temp/' + req.body.session  + '/file_' + req.body.session + '.sim'
    console.log('checking progress of', filePrefix)
    progress = [0, 0]
    for (let i = 0; i < PROCESS_LIMIT; i++) {
      try {
        const fileresult = fs.readFileSync(filePrefix + '_' + index + '_progress', {encoding:'utf8', flag:'r'})
        if (fileresult) {
          data = fileresult.split(' ').map(x => Number(x))
          progress[0] += data[0]
          progress[1] += data[1]
        }
      } catch (ex) {
        console.log('!!ERROR!! at index', i)
        console.log('!!ERROR!!:', ex)
      }
    }
    if (progress[1] === 0) {
      res.send({
        progress: 0
      })
      return
    }
    res.send({
      progress: Math.round(progress[0] / progress[1] * 1000) / 10
    })

    return
  } catch (ex) {
    console.log('ERROR', ex)
  }

  res.send({
    progress: 0
  })
})


async function runUploadJSSimulation(reqBody, simulationType, reqSession=null) {
  const session = reqSession? reqSession : getSession()
  const {extent, data, simBoundary, featureBoundary, gridSize} = reqBody
  const otherInfo = {}
  const boundClipper = new Shape([featureBoundary.map(coord => {return {X: coord[0] * 1000000, Y: coord[1] * 1000000}})])
  boundClipper.fixOrientation()
  console.log('boundClipper', boundClipper, boundClipper.totalArea())

  const mfn = new SIMFuncs();
  await mfn.io.ImportData(data, 'sim');

  const allObstructions = mfn.query.Get('pg', null)
  mfn.attrib.Set(allObstructions, 'cluster', 1)
  mfn.attrib.Set(allObstructions, 'type', 'obstruction')
  mfn.attrib.Set(allObstructions, 'obstruction', true)

  const bBox = mfn.calc.BBox(allObstructions)
  const boundExt = [99999, 99999, -99999, -99999];
  const featrExt = [99999, 99999, -99999, -99999];
  const coords = []
  for (const latlong of simBoundary) {
    const coord = [...proj_obj.forward(latlong), 0]
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

  const pos = mfn.make.Position(coords)
  const pgon = mfn.make.Polygon(pos)
  mfn.attrib.Set(pgon, 'type', 'site')
  mfn.attrib.Set(pgon, 'cluster', 0)

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
    if (dataCoord[0][0] && typeof dataCoord[0][0] !== 'number'){
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
        const coordShape = new Shape([dataCoord.map(coord => {return {X: coord[0] * 1000000, Y: coord[1] * 1000000}})])
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

  const gen = await generate(mfn, config, gridSize)
  if (!fs.existsSync('temp/' + session)) {
    fs.mkdirSync('temp/' + session)
  }
  const genFile = 'temp/' + session + '/file_' + session + '.sim'
  console.log('writing file: file_' + session + '.sim')
  fs.writeFileSync(genFile, gen)

  let closest_stn = {id: 'S24', dist2: null}
  if (simulationType === 'wind') {
    for (const stn of sg_wind_stn_data) {
        const distx = stn.coord[0] - bBox[0][0]
        const disty = stn.coord[1] - bBox[0][1]
        const dist2 = distx * distx + disty * disty
        if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
            closest_stn.id = stn.id
            closest_stn.dist2 = dist2
        }
    }
  }


  console.log('start running!!')

  const pool = new Piscina()
  const options = {filename: path.resolve("./", 'simulations/sim_execute.js')}
  const queues = []
  for (let i = 0; i < PROCESS_LIMIT; i++) {
    queues.push(`${simulationType} ${genFile} ${i} ${PROCESS_LIMIT} ${closest_stn.id}`)
  }
  await Promise.all(queues.map(x => pool.run(x, options)))
  // const queues = []
  // for (let i = 0; i < PROCESS_LIMIT; i++) {
  //   const p = new Promise((resolve, reject) => {
  //     try {
  //       exec(`node simulations/sim_execute ${simulationType} ${genFile} ${i} ${PROCESS_LIMIT} ${closest_stn.id}`,
  //         (error, stdout, stderr) => {
  //           if (error) {
  //             console.log(`error: ${simulationType} ${i}\n`)
  //             console.log(error)
  //             reject(error);
  //             return;
  //           }
  //           resolve(stdout)
  //         })
  //     } catch (ex) {
  //       console.log(`error: ${simulationType} ${i}\n`)
  //       console.log(ex)
  //       // fs.appendFileSync('genScript/log.txt', `error: ${type} ${file}\n`, function (err) {
  //       //   if (err) throw err;
  //       // });
  //     }
  //   })
  //   queues.push(p)
  // }
  // await Promise.all(queues)

  if (simulationType === 'wind') {
    const wind_stns = new Set()
    for (let i = 0; i < PROCESS_LIMIT; i++) {
      const wind_stn_file = `${genFile}_${i}_wind_stns.txt`
      if (fs.existsSync(wind_stn_file)) {
        const wind_stns_used = fs.readFileSync(wind_stn_file, {encoding:'utf8', flag:'r'})
        for (const stn of wind_stns_used.split(',')) {
          wind_stns.add(stn.trim())
        }
      }
    }
    otherInfo.wind_stns = Array.from(wind_stns)
  }
  let compiledResult = []
  for (let i = 0; i < PROCESS_LIMIT; i++) {
    try {
      const readfile = `${genFile}_${i}.txt`
      const fileresult = fs.readFileSync(readfile, {encoding:'utf8', flag:'r'})
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
  return [fullResult, surroundingBlks, otherInfo]
}

app.post('/solar_upload', async (req, res) => {
  try {
    const starttime = new Date()
    const [result, surrounding, _] = await runUploadJSSimulation(req.body, 'solar', session=req.body.session)
    res.send({
      result: result,
      surrounding: surrounding
    })
    const origin = req.socket.remoteAddress;

    logTime(starttime, 'solar', origin)
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
    const [result, surrounding, _] = await runUploadJSSimulation(req.body, 'sky', session=req.body.session, gridSize=10)
    res.send({
      result: result,
      surrounding: surrounding
    })
    const origin = req.socket.remoteAddress;

    logTime(starttime, 'solar', origin)
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
    const [result, surrounding, otherInfo] = await runUploadJSSimulation(req.body, 'wind', session=req.body.session)
    res.send({
      result: result,
      surrounding: surrounding,
      wind_stns: otherInfo.wind_stns
    })
    const origin = req.socket.remoteAddress;
    logTime(starttime, 'wind', origin)
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


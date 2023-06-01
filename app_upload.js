const express = require('express')
const cors = require('cors')
const generate = require("./simulations/sim_generate").execute;
const Shape = require('@doodle3d/clipper-js').default;


const shapefile = require("shapefile");
const proj4 = require('proj4');
const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');
const { exec } = require("child_process");
const { sg_wind_stn_data } = require('./simulations/sg_wind_station_data');
const { test_data } = require('./test_data');


const app = express()
app.use(cors())
app.use(express.json())

const port = 5203

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
const SIM_DISTANCE_LIMIT_METER =  300
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




async function runUploadJSSimulation(reqBody, simulationType, reqSession=null) {
  const session = reqSession? reqSession : getSession()
  const {extent, data, simBoundary, featureBoundary, gridSize} = reqBody

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

  const shpFile = await shapefile.open("../ucdl-simulation/src/assets/_shp_/singapore_buildings.shp")

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
  fs.writeFileSync('./test_with_surrounding1.sim', gen)

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

  const queues = []
  for (let i = 0; i < PROCESS_LIMIT; i++) {
    const p = new Promise((resolve, reject) => {
      try {
        exec(`node simulations/sim_execute ${simulationType} ${genFile} ${i} ${PROCESS_LIMIT} ${closest_stn.id}`,
          (error, stdout, stderr) => {
            if (error) {
              console.log(`error: ${simulationType} ${i}\n`)
              console.log(error)
              // fs.appendFileSync('genScript/log.txt', `error: ${type} ${file}\n`, function (err) {
              //   if (err) throw err;
              // });
              reject(error);
              return;
            }
            resolve(stdout)
          })
      } catch (ex) {
        console.log(`error: ${simulationType} ${i}\n`)
        console.log(ex)
        // fs.appendFileSync('genScript/log.txt', `error: ${type} ${file}\n`, function (err) {
        //   if (err) throw err;
        // });
      }
    })
    queues.push(p)
  }
  await Promise.all(queues)
  for (const p of queues) { 
    console.log(await p)
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
  return [fullResult, surroundingBlks]
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

app.post('/solar_upload', async (req, res) => {
  try {
    const starttime = new Date()
    const [result, surrounding] = await runUploadJSSimulation(req.body, 'solar', session=req.body.session)
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
    const [result, surrounding] = await runUploadJSSimulation(req.body, 'sky', session=req.body.session, gridSize=10)
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
    const [result, surrounding] = await runUploadJSSimulation(req.body, 'wind', session=req.body.session)
    res.send({
      result: result,
      surrounding: surrounding
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

// async function run_test() {
//     const starttime = new Date()
//     const result = await runUploadJSSimulation(test_data.extent, test_data.data, 'wind', session=test_data.session)
// }

// run_test()

app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening on port ${port}`)
})
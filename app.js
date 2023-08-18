const express = require('express')
const cors = require('cors')
const THREE = require("three");
const Shape = require('@doodle3d/clipper-js').default;
const path = require('path');

const shapefile = require("shapefile");
const proj4 = require('proj4');
const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');
const { sg_wind_stn_data } = require('./simulations/sg_wind_station_data');
const { Piscina } = require('piscina');
const { config } = require('./simulations/const');
const { runRasterSimulation } = require('./sim_raster');
const { runMobiusSimulation, runUploadMobiusSimulation } = require('./sim_mobius');

// const cluster = require("cluster");
const os = require('os');

const systemCpuCores = os.cpus();
const POOL_SETTINGS = {
  // minThreads: 5,
  // maxThreads: 8,
  idleTimeout: 60000
}
let POOL = new Piscina(POOL_SETTINGS)
const EVENT_EMITTERS = {}

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

if (!fs.existsSync('temp')) {
  fs.mkdirSync('temp')
}
if (!fs.existsSync('result')) {
  fs.mkdirSync('result')
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
const SIM_DISTANCE_LIMIT_METER = 350
const SIM_DISTANCE_LIMIT_LATLONG = SIM_DISTANCE_LIMIT_METER / 111111
const TEMP_CLEAR_TIME = 24 * 60 * 60 * 1000

function _clearTempFolder() {
  console.log('clearing temp folder')
  const tempDir = './temp'
  const dirs = fs.readdirSync(tempDir);
  const currentTime = new Date()
  for (const dir of dirs) {
    if (!fs.existsSync(tempDir + '/' + dir)) {
      console.log('directory', tempDir + '/' + dir, 'does not exist')
      continue
    }
    console.log(dir)
    if (fs.existsSync(tempDir + '/' + dir + '/info.txt')) {
      const info = JSON.parse(fs.readFileSync(tempDir + '/' + dir + '/info.txt', { encoding: 'utf8', flag: 'r' }))
      const createdTime = new Date(info.createdTime)
      if ((currentTime - createdTime) > TEMP_CLEAR_TIME) {
        console.log('  removing dir')
        fs.rmSync(tempDir + '/' + dir, { recursive: true, force: true });
      }
    } else {
      console.log('  removing dir')
      fs.rmSync(tempDir + '/' + dir, { recursive: true, force: true });
    }
  }
}
setInterval(_clearTempFolder, 300000);
_clearTempFolder()



function onCloseRequest(session) {
  console.log('___________ request closed', session)
  if (EVENT_EMITTERS[session]) {
    EVENT_EMITTERS[session].emit('abort')
    delete EVENT_EMITTERS[session]
  }
  if (fs.existsSync(`temp/${session}`)) {
    console.log('deleting temp files of session', session)
    try {
      fs.rmSync(`temp/${session}`, { recursive: true, force: true });
    } catch (ex) {
      console.log('error deleting temp files', ex)
    }
  }
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
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, _] = await runMobiusSimulation(EVENT_EMITTERS, POOL, req.body, 'solar', session)
    const origin = req.socket.remoteAddress;
    const runtime = logTime(starttime, 'solar', origin)

    res.send({
      result: result,
      resultIndex: resultIndex,
      dimension: dimension,
      runtime: runtime,
      debugInfo: {
        cpus: systemCpuCores.length
      }
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
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, _] = await runMobiusSimulation(EVENT_EMITTERS, POOL, req.body, 'sky', session)
    const origin = req.socket.remoteAddress;
    const runtime = logTime(starttime, 'sky', origin)
    res.send({
      result: result,
      resultIndex: resultIndex,
      dimension: dimension,
      runtime: runtime,
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
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, extent, otherInfo] = await runRasterSimulation(EVENT_EMITTERS, POOL, req.body, 'wind', session)
    const origin = req.socket.remoteAddress;
    const runtime = logTime(starttime, 'wind', origin)
    res.send({
      result: result,
      resultIndex: resultIndex,
      dimension: dimension,
      extent: extent,
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


app.post('/solar_upload', async (req, res) => {
  try {
    const starttime = new Date()
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, surrounding, _] = await runUploadMobiusSimulation(EVENT_EMITTERS, POOL, req.body, 'solar', session)
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
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, surrounding, _] = await runUploadMobiusSimulation(EVENT_EMITTERS, POOL, req.body, 'sky', session)
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
    const session = req.body.session
    req.socket.on('close', (_) => onCloseRequest(session))
    const [result, resultIndex, dimension, surrounding, otherInfo] = await runUploadMobiusSimulation(EVENT_EMITTERS, POOL, req.body, 'wind', session)
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


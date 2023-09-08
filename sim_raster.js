const Shape = require('@doodle3d/clipper-js').default;

const THREE = require('three');
const shapefile = require("shapefile");
const proj4 = require('proj4');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios').default;
const path = require('path');
const { sg_wind_stn_data } = require('./simulations/sg_wind_station_data');
const EventEmitter = require('events');

// const WIND_FA_DIR = 'simulations_raster/raster/FA.tif'
// const WIND_FA_DATA = fs.readFileSync(WIND_FA_DIR)
// const WIND_FA = parseGeoraster(WIND_FA_DATA)
// const WIND_BD_DIR = 'simulations_raster/raster/building.tif'
// const WIND_BD_DATA = fs.readFileSync(WIND_BD_DIR)
// const WIND_BD = parseGeoraster(WIND_BD_DATA)
let WIND_CLIP_URL
if (process.platform === 'win32') {
  WIND_CLIP_URL = 'http://localhost:5000/wind_clip'
} else {
  WIND_CLIP_URL = 'https://mdp.frs.ethz.ch/api/py/wind_clip'
}
const TILES_PER_WORKER = 500
const NUM_TILES_PER_CACHE_FILE = 200



function getSession() {
  return 's' + (new Date()).getTime()
}

function _createProjection() {
  const proj_from_str = 'WGS84';
  const proj_to_str = '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' +
    '+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
    '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs';
  const proj_obj = proj4(proj_from_str, proj_to_str);
  return proj_obj;
}
const proj_obj = _createProjection()


async function runRasterSimulation(EVENT_EMITTERS, POOL, reqBody, simulationType, reqSession = null) {
  const session = reqSession ? reqSession : getSession()
  console.log('session', session)
  EVENT_EMITTERS[session] = new EventEmitter()

  const { bounds, gridSize } = reqBody
  console.log('boundary', bounds)
  const p = await axios.post(WIND_CLIP_URL, {
    bounds: bounds,
    grid_size: gridSize
  }).then(resp => resp.data).catch(function (error) { console.log(error); });

  const wind_stns = new Set()
  for (const coord of bounds) {
    const closest_stn = {id: '', dist2: null}
    for (const stn of sg_wind_stn_data) {
      const distx = stn.longitude - coord[0]
      const disty = stn.latitude - coord[1]
      const dist2 = distx * distx + disty * disty
      if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
        closest_stn.id = stn.id
        closest_stn.dist2 = dist2
      }
    }
    wind_stns.add(closest_stn.id)
  }

  const { fa_mask_result, bd_mask_result, sim_mask_result,
    fa_affine_transf, sim_affine_transf,
    fa_bottom_left, sim_bottom_left,
    transf_bound,
    extent, proj, nodata, success } = p;
  const fa_str = JSON.stringify(fa_mask_result)
  const bd_str = JSON.stringify(bd_mask_result)
  const sim_str = JSON.stringify(sim_mask_result)
  const fa_bottom_left_str = JSON.stringify(fa_bottom_left)
  const sim_bottom_left_str = JSON.stringify(extent)
  const bottom_left_lat_long = proj_obj.inverse([extent[0], extent[1]])
  const bottom_left = [extent[0], extent[1], bottom_left_lat_long[0], bottom_left_lat_long[1]]
  if (!success) {
    console.log('clipping failed')
    return [[], [], [0, 0, 0, 0], {}]
  }

  const cacheDist = NUM_TILES_PER_CACHE_FILE * gridSize
  const cachedResultRange = [
    Math.floor(extent[0] / cacheDist) * cacheDist,
    Math.floor(extent[1] / cacheDist) * cacheDist,
    Math.floor(extent[2] / cacheDist) * cacheDist,
    Math.floor(extent[3] / cacheDist) * cacheDist,
  ]
  const cachedResult = {}
  for (let x = cachedResultRange[0]; x <= cachedResultRange[2]; x += cacheDist) {
    for (let y = cachedResultRange[1]; y <= cachedResultRange[3]; y += cacheDist) {
      // cachedResult[`${x}_${y}`] = []
      // for (let i = 0; i < NUM_TILES_PER_CACHE_FILE; i++) {
      //   const col = []
      //   for (let j = 0; j < NUM_TILES_PER_CACHE_FILE; j++) {
      //     col.push(null)
      //   }
      //   cachedResult[`${x}_${y}`].push(col)
      // }

      const fileName = `result/${simulationType}_${gridSize}_${x}_${y}`
      if (!fs.existsSync(fileName)) {
        cachedResult[`${x}_${y}`] = []
        for (let i = 0; i < NUM_TILES_PER_CACHE_FILE; i++) {
          const col = []
          for (let j = 0; j < NUM_TILES_PER_CACHE_FILE; j++) {
            col.push(null)
          }
          cachedResult[`${x}_${y}`].push(col)
        }
      } else {
        const cachedResultText = fs.readFileSync(fileName, { encoding: 'utf8' })
        cachedResult[`${x}_${y}`] = JSON.parse(cachedResultText)
      }
    }
  }


  const rows = Math.ceil(sim_mask_result.length / gridSize)
  const cols = Math.ceil(sim_mask_result[0].length / gridSize)
  const total = rows * cols

  let processLimit = 200

  if (total < processLimit * 10) {
    processLimit = Math.floor(total / 10)
  } else if (processLimit < total / 10000) {
    processLimit = Math.ceil(total / 10000)
  }
  const numCoordsPerThread = Math.ceil(total / processLimit)
  let queues = []
  let cachedQueues = []

  for (let i = 0; i < processLimit; i++) {
    const startNum = numCoordsPerThread * i
    let endNum = numCoordsPerThread * (i + 1)
    if (endNum > total) { endNum = total; }
    const simCoords = []
    const cachedCoords = []
    for (let j = startNum; j < endNum; j++) {
      const offsetX = j % cols
      const offsetY = Math.floor(j / cols)
      const xcoord = extent[0] + offsetX * gridSize
      const ycoord = extent[1] + offsetY * gridSize
      const cachedCoord = [
        Math.floor(xcoord / cacheDist) * cacheDist,
        Math.floor(ycoord / cacheDist) * cacheDist,
      ]
      cachedCoord.push(Math.floor((xcoord - cachedCoord[0]) / gridSize))
      cachedCoord.push(Math.floor((ycoord - cachedCoord[1]) / gridSize))
      const cachedResultMatch = cachedResult[`${cachedCoord[0]}_${cachedCoord[1]}`]
      if (cachedResultMatch && (cachedResultMatch[cachedCoord[2]][cachedCoord[3]] || cachedResultMatch[cachedCoord[2]][cachedCoord[3]] === 0)) {
        simCoords.push([null, null])
        cachedCoords.push([xcoord, ycoord, cachedResultMatch[cachedCoord[2]][cachedCoord[3]]])
      } else {
        simCoords.push([xcoord, ycoord])
        cachedCoords.push([null, null])
      }
      // simCoords.push([xcoord, ycoord])
      // cachedCoords.push([null, null])

    }
    if (simCoords.length > 0) {
      queues.push(`${JSON.stringify(transf_bound)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}|||true`)
    }
    if (cachedCoords.length > 0) {
      cachedQueues.push(`${JSON.stringify(transf_bound)}|||${JSON.stringify(cachedCoords)}|||${gridSize}|||${startNum}|||true`)
    }
  }
  const gen_result_queues = []
  if (!EVENT_EMITTERS[session]) { return }
  const options_gen = { 
    filename: path.resolve("./", 'simulations/check_sim_area.js'),
    // signal: EVENT_EMITTERS[session]
  }
  EVENT_EMITTERS[session].setMaxListeners(queues.length)
  await Promise.all(queues.map(x => gen_result_queues.push(POOL.run(x, options_gen))))
  let gen_result = []
  let gen_result_index = []
  for (const result_promise of gen_result_queues) {
    const r = await result_promise
    gen_result = gen_result.concat(r[0])
    gen_result_index = gen_result_index.concat(r[1])
  }
  const cached_result_queues = []
  if (!EVENT_EMITTERS[session]) { return }
  EVENT_EMITTERS[session].setMaxListeners(cachedQueues.length)
  await Promise.all(cachedQueues.map(x => cached_result_queues.push(POOL.run(x, options_gen))))
  let cached_result = []
  let cached_result_index = []
  for (const result_promise of cached_result_queues) {
    const r = await result_promise
    cached_result = cached_result.concat(r[0].map(c => c[2]))
    cached_result_index = cached_result_index.concat(r[1])
  }

  if (gen_result.length < (processLimit * 10)) {
    processLimit = Math.floor(gen_result.length / 10)
  } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
    processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
  }
  queues = []
  for (let i = 0; i < processLimit; i++) {
    const fromIndex = Math.ceil(gen_result.length / processLimit) * i
    let toIndex = Math.ceil(gen_result.length / processLimit) * (i + 1)
    if (fromIndex >= gen_result.length) {
      processLimit = i
      break
    }
    if (toIndex >= gen_result.length) { toIndex = gen_result.length }
    const threadCoords = gen_result.slice(fromIndex, toIndex)
    queues.push(`${JSON.stringify(threadCoords)}|||${fa_str}|||${bd_str}|||${sim_str}|||${fa_bottom_left_str}|||${sim_bottom_left_str}|||${gridSize}`)
  }
  console.log('!!! number of tasks:', queues.length)
  if (!EVENT_EMITTERS[session]) { return }
  const options_ex = { 
    filename: path.resolve("./", 'simulations_raster/wind.js'),
    // signal: EVENT_EMITTERS[session]
  }
  EVENT_EMITTERS[session].setMaxListeners(queues.length)
  const result_queues = queues.map(x => POOL.run(x, options_ex))
  let result = []
  for (const q of result_queues) {
    const r = await (q)
    result = result.concat(r)
  }

  for (let i = 0; i < result.length; i++) {
    const offsetX = gen_result_index[i] % cols
    const offsetY = Math.floor(gen_result_index[i] / cols)
    const xcoord = extent[0] + offsetX * gridSize
    const ycoord = extent[1] + offsetY * gridSize
    const cachedCoord = [
      Math.floor(xcoord / cacheDist) * cacheDist,
      Math.floor(ycoord / cacheDist) * cacheDist,
    ]
    cachedCoord.push(Math.floor((xcoord - cachedCoord[0]) / gridSize))
    cachedCoord.push(Math.floor((ycoord - cachedCoord[1]) / gridSize))
    // cachedCoord.push((xcoord - cachedCoord[0]) / gridSize)
    // cachedCoord.push((ycoord - cachedCoord[1]) / gridSize)
    const cachedResultMatch = cachedResult[`${cachedCoord[0]}_${cachedCoord[1]}`]
    if (cachedResultMatch) {
      cachedResultMatch[cachedCoord[2]][cachedCoord[3]] = result[i]
    }
  }
  for (const file in cachedResult) {
    fs.writeFileSync(`result/${simulationType}_${gridSize}_${file}`, JSON.stringify(cachedResult[file]))
  }

  console.log('--------------------------------')
  return [result.concat(cached_result), gen_result_index.concat(cached_result_index), [cols, rows], bottom_left, { wind_stns: Array.from(wind_stns) }]
}

module.exports = {
  runRasterSimulation: runRasterSimulation
}
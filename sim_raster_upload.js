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
const { SIMFuncs } = require('@design-automation/mobius-sim-funcs');

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



function getSession() {
  return 's' + (new Date()).getTime()
}

function _createProjection(fromcrs, tocrs) {
  const proj_obj = proj4(fromcrs, tocrs);
  return proj_obj;
}
const proj_obj_svy = _createProjection('WGS84',
  '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' +
  '+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
  '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
)
const proj_obj_mob = _createProjection('WGS84',
  `+proj=tmerc +lat_0=${LONGLAT[1]} +lon_0=${LONGLAT[0]} ` +
  `+k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`
)

async function runUploadRasterSimulation(EVENT_EMITTERS, POOL, reqBody, simulationType, reqSession = null) {
  const session = reqSession ? reqSession : getSession()
  EVENT_EMITTERS[session] = new EventEmitter()
  const { extent, data, simBoundary, featureBoundary, gridSize } = reqBody
  const otherInfo = {}
  const boundClipper = new Shape([featureBoundary.map(coord => { return { X: coord[0] * 1000000, Y: coord[1] * 1000000 } })])
  boundClipper.fixOrientation()
  const obsLines = []
  const obsPgons = []
  const buildings = []

  const mfn = new SIMFuncs();
  await mfn.io.ImportData(data, 'sim');

  // TODO: add uploaded polygons into obsLines
  let allObstructions = mfn.query.Get('pg', null)
  const transf = [null, null, 0]
  for (const pgon of allObstructions) {
    const pgCoords = mfn.attrib.Get(mfn.query.Get('ps', pgon), 'xyz')
    const newPgon = pgCoords.map(c => {
      const latlong = proj_obj_mob.inverse([c[0], c[1]])
      const newCoord = proj_obj_svy.forward(latlong)
      return [newCoord[0], newCoord[1], c[2]]
    })
    obsPgons.push(newPgon)
    transf[0] = newPgon[0][0] - pgCoords[0][0]
    transf[1] = newPgon[0][1] - pgCoords[0][1]
  }
  mfn.modify.Move(allObstructions, transf)

  const limCoords = [99999, 99999, -99999, -99999];
  const boundExt = [99999, 99999, -99999, -99999];
  const featrExt = [99999, 99999, -99999, -99999];
  const coords = []
  for (const latlong of simBoundary) {
    const coord = [...proj_obj_svy.forward(latlong), 0]
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
  if (coords[0][0] !== coords[coords.length - 1][0] && coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push(coords[0])
  }

  for (const latlong of featureBoundary) {
    featrExt[0] = Math.min(latlong[0], featrExt[0])
    featrExt[1] = Math.min(latlong[1], featrExt[1])
    featrExt[2] = Math.max(latlong[0], featrExt[2])
    featrExt[3] = Math.max(latlong[1], featrExt[3])
  }

  const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

  const limExt = [
    boundExt[0] - SIM_DISTANCE_LIMIT_LATLONG,
    boundExt[1] - SIM_DISTANCE_LIMIT_LATLONG,
    boundExt[2] + SIM_DISTANCE_LIMIT_LATLONG,
    boundExt[3] + SIM_DISTANCE_LIMIT_LATLONG,
  ]

  // add surrounding buildings as obstruction
  const surroundingBlks = []
  while (true) {
    const result = await shpFile.read()
    if (!result || result.done) { break; }

    let check = false
    let dataCoord = result.value.geometry.coordinates[0]
    const height = result.value.properties.AGL

    if (result.value.geometry.type === 'MultiPolygon') {
      dataCoord = dataCoord[0]
    }

    // check if the building can be used as surrounding obstruction
    for (const c of dataCoord) {
      if (c[0] > limExt[0] && c[1] > limExt[1] && c[0] < limExt[2] && c[1] < limExt[3]) {
        const coordShape = new Shape([dataCoord.map(coord => { return { X: coord[0] * 1000000, Y: coord[1] * 1000000 } })])
        coordShape.fixOrientation()
        const intersection = coordShape.intersect(boundClipper)
        if (intersection.paths.length > 0) { check = false } else { check = true }
        break
      }
    }
    if (!check) { continue }

    // check if the building can be used for checking vertical obstruction:
    //   if a sensor is contained within one => no exposure
    for (const c of dataCoord) {
      if (c[0] > boundExt[0] && c[1] > boundExt[1] && c[0] < boundExt[2] && c[1] < boundExt[3]) {
        const buildingData = []
        for (const bound of result.value.geometry.coordinates) {
          let b = bound
          if (result.value.geometry.type === 'MultiPolygon') {
            b = bound[0]
          }
          buildingData.push(b.map(coord => {
            const nc = proj_obj_svy.forward(coord)
            return { X: Math.round(nc[0] * 10000), Y: Math.round(nc[1] * 10000) }
          }))
        }
        buildings.push(buildingData)
        break
      }
    }


    const pos_mob = []
    const pos_svy = []
    for (const c of dataCoord) {
      const c_mob = proj_obj_mob.forward(c)
      const c_svy = proj_obj_svy.forward(c)
      c_mob.push(0)
      pos_mob.push(c_mob)
      pos_svy.push([c_svy[0], c_svy[1], height])
    }
    obsLines.push([pos_svy[pos_svy.length - 1], pos_svy[0], height])
    for (let i = 1; i < pos_svy.length; i++) {
      obsLines.push([pos_svy[i - 1], pos_svy[i], height])
    }

    surroundingBlks.push({
      coord: pos_mob,
      height: result.value.properties.AGL
    })
  }

  // mfn.io.Geolocate([config["latitude"], config["longitude"]], 0, 0);
  // find rows/cols number + total number of grids
  const cols = Math.ceil((limCoords[2] - limCoords[0]) / gridSize) + 1
  const rows = Math.ceil((limCoords[3] - limCoords[1]) / gridSize) + 1
  const total = rows * cols

  let processLimit = 200

  if (total < processLimit * 10) {
    processLimit = Math.ceil(total / 10)
  } else if (processLimit < total / 10000) {
    processLimit = Math.ceil(total / 10000)
  }
  const numCoordsPerThread = Math.ceil(total / processLimit)
  let queues = []
  

  // go through each grid coordinate (divide up into threads)
  for (let i = 0; i < processLimit; i++) {
    const startNum = numCoordsPerThread * i
    let endNum = numCoordsPerThread * (i + 1)
    if (endNum > total) { endNum = total; }
    const simCoords = []
    for (let j = startNum; j < endNum; j++) {
      const offsetX = j % cols
      const offsetY = Math.floor(j / cols)
      const xcoord = limCoords[0] + offsetX * gridSize
      const ycoord = limCoords[1] + offsetY * gridSize
      simCoords.push([xcoord, ycoord])
    }
    // add the coords threads into queue for check_sim_area script (check if the grid is inside the simulation boundary)
    if (simCoords.length > 0) {
      queues.push(`${JSON.stringify(coords)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}|||true`)
    }
  }

  // run check_sim_area script
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


  if (gen_result.length < (processLimit * 10)) {
    processLimit = Math.ceil(gen_result.length / 10)
  } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
    processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
  }
  console.log('processLimit', processLimit)

  // divide the grids up for simulation
  queues = []
  const linesStr = JSON.stringify(obsLines)
  const pgonsStr = JSON.stringify(obsPgons)
  const buildingsStr = JSON.stringify(buildings)
  for (let i = 0; i < processLimit; i++) {
    const fromIndex = Math.ceil(gen_result.length / processLimit) * i
    let toIndex = Math.ceil(gen_result.length / processLimit) * (i + 1)
    if (fromIndex >= gen_result.length) {
      processLimit = i
      break
    }
    if (toIndex >= gen_result.length) { toIndex = gen_result.length }
    const threadCoords = gen_result.slice(fromIndex, toIndex)
    queues.push(`${linesStr}|||${pgonsStr}|||${buildingsStr}|||${JSON.stringify(threadCoords)}|||${gridSize}|||${boundExt[1]}|||"${i+1}`)
  }

  console.log('!!! number of tasks:', queues.length)
  if (!EVENT_EMITTERS[session]) { return }
  const options_ex = {
    filename: path.resolve("./", `simulations_raster/${simulationType}.js`),
    // signal: EVENT_EMITTERS[session]
  }


  // run simulation
  EVENT_EMITTERS[session].setMaxListeners(queues.length)
  const result_queues = queues.map(x => POOL.run(x + `/${queues.length}"`, options_ex))
  let result = []
  for (const q of result_queues) {
    const r = await (q)
    result = result.concat(r)
  }

  return [result, gen_result_index, [cols, rows], surroundingBlks, otherInfo]

}

async function runUploadRasterSimulationWind(EVENT_EMITTERS, POOL, reqBody, simulationType, reqSession = null) {
  const session = reqSession ? reqSession : getSession()
  console.log('session', session)
  EVENT_EMITTERS[session] = new EventEmitter()

  const { extent, data, simBoundary, featureBoundary, gridSize } = reqBody

  // const { bounds, gridSize } = reqBody
  // console.log('boundary', bounds)
  console.log(data)

  // find nearest wind stations for HUD
  const wind_stns = new Set()
  for (const coord of simBoundary) {
    const closest_stn = { id: '', dist2: null }
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

  // get Frontal Area data from the python server for this boundary
  const p = await axios.post(WIND_CLIP_URL, {
    bounds: simBoundary,
    grid_size: gridSize
  }).then(resp => resp.data).catch(function (error) { console.log(error); });

  // process Frontal Area data
  //  _ convert the data to string
  //  _ find extent
  const { fa_mask_result, bd_mask_result, sim_mask_result,
    fa_affine_transf, sim_affine_transf,
    fa_bottom_left, sim_bottom_left,
    transf_bound, proj, nodata, success } = p;
  const rExtent = p.extent
  if (!success) {
    console.log('clipping failed')
    return [[], [], [0, 0, 0, 0], {}]
  }
  const fa_str = JSON.stringify(fa_mask_result)
  const bd_str = JSON.stringify(bd_mask_result)
  const sim_str = JSON.stringify(sim_mask_result)
  const fa_bottom_left_str = JSON.stringify(fa_bottom_left)
  const sim_bottom_left_str = JSON.stringify(rExtent)
  const bottom_left_lat_long = proj_obj_svy.inverse([rExtent[0], rExtent[1]])
  const bottom_left = [rExtent[0], rExtent[1], bottom_left_lat_long[0], bottom_left_lat_long[1]]

  // look for existing result in cache
  const cacheDist = NUM_TILES_PER_CACHE_FILE * gridSize
  const cachedResultRange = [
    Math.floor(rExtent[0] / cacheDist) * cacheDist,
    Math.floor(rExtent[1] / cacheDist) * cacheDist,
    Math.floor(rExtent[2] / cacheDist) * cacheDist,
    Math.floor(rExtent[3] / cacheDist) * cacheDist,
  ]
  const cachedResult = {}
  for (let x = cachedResultRange[0]; x <= cachedResultRange[2]; x += cacheDist) {
    for (let y = cachedResultRange[1]; y <= cachedResultRange[3]; y += cacheDist) {

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

  // find rows/cols number + total number of grids
  const rows = Math.ceil(sim_mask_result.length / gridSize)
  const cols = Math.ceil(sim_mask_result[0].length / gridSize)
  const total = rows * cols

  let processLimit = 200

  if (total < processLimit * 10) {
    processLimit = Math.ceil(total / 10)
  } else if (processLimit < total / 10000) {
    processLimit = Math.ceil(total / 10000)
  }
  const numCoordsPerThread = Math.ceil(total / processLimit)
  let queues = []
  let cachedQueues = []

  // go through each grid coordinate (divide up into threads)
  for (let i = 0; i < processLimit; i++) {
    const startNum = numCoordsPerThread * i
    let endNum = numCoordsPerThread * (i + 1)
    if (endNum > total) { endNum = total; }
    const simCoords = []
    const cachedCoords = []
    for (let j = startNum; j < endNum; j++) {
      // for each grid, find x, y
      const offsetX = j % cols
      const offsetY = Math.floor(j / cols)
      const xcoord = rExtent[0] + offsetX * gridSize
      const ycoord = rExtent[1] + offsetY * gridSize

      // for each grid, check if result exists in cache
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
        // if no cached result, add the coord for simulation
        simCoords.push([xcoord, ycoord])
        cachedCoords.push([null, null])
      }
    }
    // add the coords threads into queue for check_sim_area script (check if the grid is inside the simulation boundary)
    if (simCoords.length > 0) {
      queues.push(`${JSON.stringify(transf_bound)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}|||true`)
    }
    if (cachedCoords.length > 0) {
      cachedQueues.push(`${JSON.stringify(transf_bound)}|||${JSON.stringify(cachedCoords)}|||${gridSize}|||${startNum}|||true`)
    }
  }

  // run check_sim_area script
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
    processLimit = Math.ceil(gen_result.length / 10)
  } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
    processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
  }

  // divide the grids up for simulation
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

  // run simulation
  EVENT_EMITTERS[session].setMaxListeners(queues.length)
  const result_queues = queues.map(x => POOL.run(x, options_ex))
  let result = []
  for (const q of result_queues) {
    const r = await (q)
    result = result.concat(r)
  }

  // read result files and combine result
  for (let i = 0; i < result.length; i++) {
    const offsetX = gen_result_index[i] % cols
    const offsetY = Math.floor(gen_result_index[i] / cols)
    const xcoord = rExtent[0] + offsetX * gridSize
    const ycoord = rExtent[1] + offsetY * gridSize
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

  // write result
  for (const file in cachedResult) {
    fs.writeFileSync(`result/${simulationType}_${gridSize}_${file}`, JSON.stringify(cachedResult[file]))
  }

  console.log('--------------------------------')
  return [result.concat(cached_result), gen_result_index.concat(cached_result_index), [cols, rows], bottom_left, { wind_stns: Array.from(wind_stns) }]
}



module.exports = {
  runUploadRasterSimulation: runUploadRasterSimulation,
  runUploadRasterSimulationWind: runUploadRasterSimulationWind
}
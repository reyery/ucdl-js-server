const Shape = require('@doodle3d/clipper-js').default;

const THREE = require('three');
const shapefile = require("shapefile");
const proj4 = require('proj4');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios').default;
const path = require('path');

// const WIND_FA_DIR = 'simulations_raster/raster/FA.tif'
// const WIND_FA_DATA = fs.readFileSync(WIND_FA_DIR)
// const WIND_FA = parseGeoraster(WIND_FA_DATA)
// const WIND_BD_DIR = 'simulations_raster/raster/building.tif'
// const WIND_BD_DATA = fs.readFileSync(WIND_BD_DIR)
// const WIND_BD = parseGeoraster(WIND_BD_DATA)

const WIND_CLIP_URL = 'http://172.26.51.153:5000' + '/wind_clip'
const TILES_PER_WORKER = 500
const NUM_TILES_PER_CACHE_FILE = 200

function _createProjection() {
    const proj_from_str = 'WGS84';
    const proj_to_str = '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' + 
        '+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
        '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs';
    const proj_obj = proj4(proj_from_str, proj_to_str);
    return proj_obj;
  }
const proj_obj = _createProjection()


async function runRasterSimulation(POOL, reqBody, simulationType, reqSession = null) {
    const session = reqSession ? reqSession : getSession()
    const { bounds, gridSize} = reqBody
    console.log('boundary', bounds)
    const p = await axios.post(WIND_CLIP_URL, {
        bounds: bounds,
        grid_size: gridSize
    }).then(resp => resp.data) .catch(function (error) { console.log(error); });
    const { fa_mask_result, bd_mask_result, sim_mask_result,
        fa_affine_transf, sim_affine_transf,
        fa_bottom_left, sim_bottom_left, 
        transf_bound,
        extent, proj, nodata, success} = p;
    if (!success) { 
        console.log('clipping failed')
        return [[], [], [0,0,0,0], {}]
    }
    if (!fs.existsSync(`temp/${session}`)) {
        fs.mkdirSync(`temp/${session}`)
    }
    const dataFiles = ['fa_mask_result', 'bd_mask_result', 'sim_mask_result', 'fa_affine_transf', 'sim_affine_transf']
    dataFiles.forEach(filename => {
        fs.writeFileSync(`temp/${session}/${filename}`, JSON.stringify(p[filename]))
    })
    const rows = sim_mask_result.length
    const cols = sim_mask_result[0].length
    const total = rows * cols

    let processLimit = 200

    if (total < processLimit * 10) {
      processLimit = Math.floor(total / 10)
    } else if (processLimit < total / 10000) {
      processLimit = Math.ceil(total / 10000)
    }
    const numCoordsPerThread = Math.ceil(total / processLimit)
    const options_gen = { filename: path.resolve("./", 'simulations/check_sim_area.js') }
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
        const xcoord = sim_bottom_left[0] + offsetX * gridSize
        const ycoord = sim_bottom_left[1] - offsetY * gridSize
        // const cachedCoord = [
        //   Math.floor(xcoord / cacheDist) * cacheDist,
        //   Math.floor(ycoord / cacheDist) * cacheDist,
        // ]
        // cachedCoord.push((xcoord - cachedCoord[0]) / gridSize)
        // cachedCoord.push((ycoord - cachedCoord[1]) / gridSize)
        // const cachedResultMatch = cachedResult[`${cachedCoord[0]}_${cachedCoord[1]}`]
        // if (cachedResultMatch && cachedResultMatch[cachedCoord[2]][cachedCoord[3]]) {
        //   simCoords.push([null, null])
        //   cachedCoords.push([xcoord, ycoord, cachedResultMatch[cachedCoord[2]][cachedCoord[3]]])
        // } else {
        //   simCoords.push([xcoord, ycoord])
        //   cachedCoords.push([null, null])
        // }
        simCoords.push([xcoord, ycoord])
        cachedCoords.push([null, null])
      }
      if (simCoords.length > 0) {
        queues.push(`${JSON.stringify(transf_bound)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}|||true`)
      }
    //   if (cachedCoords.length > 0) {
    //     cachedQueues.push(`${JSON.stringify(coords)}|||${JSON.stringify(cachedCoords)}|||${gridSize}|||${startNum}|||true`)
    //   }
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
    
    if (gen_result.length < (processLimit * 10)) {
        processLimit = Math.floor(gen_result.length / 10)
    } else if ((gen_result.length / TILES_PER_WORKER) > processLimit) {
        processLimit = Math.ceil(gen_result.length / TILES_PER_WORKER)
    }
    // for (let i = 0; i < processLimit; i++) {
    //     const fromIndex = Math.ceil(gen_result.length / processLimit) * i
    //     let toIndex = Math.ceil(gen_result.length / processLimit) * (i + 1)
    //     if (fromIndex >= gen_result.length) {
    //       processLimit = i
    //       break
    //     }
    //     if (toIndex >= gen_result.length) { toIndex = gen_result.length }
    //     const genFile = `temp/${session}/file_${session}_${i}`
    //     const threadCoords = gen_result.slice(fromIndex, toIndex)
    //     fs.writeFileSync(genFile, JSON.stringify(threadCoords))
    //     queues.push(`${simulationType} ${obsFile} ${genFile} ${gridSize}`)
    // }
    // await Promise.all(queues.map(x => POOL.run(x, options_ex)))
    
    
    return [[], [], [0,0,0,0], {}]
    // const gridSize = reqBody.gridSize
    // let processLimit = RESOURCE_LIM_DICT[gridSize]
    // const otherInfo = {}
    // const limCoords = [99999, 99999, -99999, -99999];
    // const limExt = [999, 999, -999, -999];
    // const coords = []
    // for (const latlong of boundary) {
    //   const coord = [...proj_obj.forward(latlong), 0]
    //   limCoords[0] = Math.min(Math.floor(coord[0] / gridSize) * gridSize, limCoords[0])
    //   limCoords[1] = Math.min(Math.floor(coord[1] / gridSize) * gridSize, limCoords[1])
    //   limCoords[2] = Math.max(Math.ceil(coord[0] / gridSize) * gridSize, limCoords[2])
    //   limCoords[3] = Math.max(Math.ceil(coord[1] / gridSize) * gridSize, limCoords[3])
    //   limExt[0] = Math.min(latlong[0], limExt[0])
    //   limExt[1] = Math.min(latlong[1], limExt[1])
    //   limExt[2] = Math.max(latlong[0], limExt[2])
    //   limExt[3] = Math.max(latlong[1], limExt[3])
    //   coords.push(coord)
    // }
    // if (coords[0][0] !== coords[coords.length - 1][0] && coords[0][1] !== coords[coords.length - 1][1]) {
    //   coords.push(coords[0])
    // }

    // pyProg.stdout.on('data', function(data) {

    //     console.log(data.toString());
    //     res.write(data);
    //     res.end('end');
    // });

}

module.exports = {
    runRasterSimulation: runRasterSimulation
}
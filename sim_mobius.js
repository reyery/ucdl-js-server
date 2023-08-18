const THREE = require("three");
const Shape = require('@doodle3d/clipper-js').default;
const path = require('path');
const EventEmitter = require('events');

const shapefile = require("shapefile");
const proj4 = require('proj4');
const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');
const { sg_wind_stn_data } = require('./simulations/sg_wind_station_data');
const { config } = require('./simulations/const');

const TILES_PER_WORKER = 200
const NUM_TILES_PER_CACHE_FILE = 200

if (!fs.existsSync('temp')) {
    fs.mkdirSync('temp')
}
if (!fs.existsSync('result')) {
    fs.mkdirSync('result')
}

const LONGLAT = [103.778329, 1.298759];
const RESOURCE_LIM_DICT = {
    10: 40,
    5: 60,
    2: 128,
    1: 128
}
const SIM_DISTANCE_LIMIT_METER = 350
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
  
async function runMobiusSimulation(EVENT_EMITTERS, POOL, reqBody, simulationType, reqSession = null) {
    const session = reqSession ? reqSession : getSession()
    EVENT_EMITTERS[session] = new EventEmitter()
    const boundary = reqBody.bounds
    const gridSize = reqBody.gridSize
    let processLimit = RESOURCE_LIM_DICT[gridSize]
    const otherInfo = {}
    const limCoords = [99999, 99999, -99999, -99999];
    const limExt = [999, 999, -999, -999];
    const coords = []
    for (const latlong of boundary) {
        const coord = [...proj_obj.forward(latlong), 0]
        limCoords[0] = Math.min(Math.floor(coord[0] / gridSize) * gridSize, limCoords[0])
        limCoords[1] = Math.min(Math.floor(coord[1] / gridSize) * gridSize, limCoords[1])
        limCoords[2] = Math.max(Math.ceil(coord[0] / gridSize) * gridSize, limCoords[2])
        limCoords[3] = Math.max(Math.ceil(coord[1] / gridSize) * gridSize, limCoords[3])
        limExt[0] = Math.min(latlong[0], limExt[0])
        limExt[1] = Math.min(latlong[1], limExt[1])
        limExt[2] = Math.max(latlong[0], limExt[2])
        limExt[3] = Math.max(latlong[1], limExt[3])
        coords.push(coord)
    }
    if (coords[0][0] !== coords[coords.length - 1][0] && coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0])
    }
    const cacheDist = NUM_TILES_PER_CACHE_FILE * gridSize
    const cachedResultRange = [
        Math.floor(limCoords[0] / cacheDist) * cacheDist,
        Math.floor(limCoords[1] / cacheDist) * cacheDist,
        Math.floor(limCoords[2] / cacheDist) * cacheDist,
        Math.floor(limCoords[3] / cacheDist) * cacheDist,
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

    const mfn = new SIMFuncs();
    const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")

    limExt[0] -= SIM_DISTANCE_LIMIT_LATLONG
    limExt[1] -= SIM_DISTANCE_LIMIT_LATLONG
    limExt[2] += SIM_DISTANCE_LIMIT_LATLONG
    limExt[3] += SIM_DISTANCE_LIMIT_LATLONG

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
        if (simulationType === 'wind') {
            mfn.attrib.Set(pg, 'height_max', result.value.properties.AGL)
            mfn.attrib.Set(pg, 'height_min', 0)
        } else {
            mfn.make.Extrude(pg, result.value.properties.AGL, 1, 'quads')
            basePgons.push(pg)
        }
    }

    mfn.edit.Delete(basePgons, 'delete_selected')

    let allObstructions = mfn.query.Get('pg', null)
    if (allObstructions.length === 0) {
        const dummyps = mfn.make.Position([
            [limCoords[0] - 200, limCoords[1] - 200, -1],
            [limCoords[2] + 200, limCoords[3] + 200, -1],
            [limCoords[0] - 200, limCoords[3] + 200, -1]
        ])
        const dummypg = mfn.make.Polygon(dummyps)
        mfn.attrib.Set(dummypg, 'height_max', -10)
        mfn.attrib.Set(dummypg, 'height_min', -20)
        allObstructions = [dummypg]
    }

    mfn.attrib.Set(allObstructions, 'cluster', 1)
    mfn.attrib.Set(allObstructions, 'type', 'obstruction')
    mfn.attrib.Set(allObstructions, 'obstruction', true)
    mfn.io.Geolocate([config["latitude"], config["longitude"]], 0, 0);

    // console.log('limCoords', limCoords)
    // console.log('coords', coords)
    // console.log('width, height', limCoords[3] - limCoords[1], limCoords[2] - limCoords[0])
    // console.log('rows, cols', (limCoords[3] - limCoords[1]) / gridSize, (limCoords[2] - limCoords[0]) / gridSize)
    const rows = Math.ceil((limCoords[3] - limCoords[1]) / gridSize)
    const cols = Math.ceil((limCoords[2] - limCoords[0]) / gridSize)
    const total = rows * cols
    if (total < processLimit * 10) {
        processLimit = Math.floor(total / 10)
    } else if (processLimit < total / 10000) {
        processLimit = Math.ceil(total / 10000)
    }
    const numCoordsPerThread = Math.ceil(total / processLimit)
    // console.log('rows, cols', rows, cols)
    // console.log('processLimit', processLimit)
    // console.log('numCoordsPerThread', numCoordsPerThread)
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
            const xcoord = limCoords[0] + offsetX * gridSize
            const ycoord = limCoords[1] + offsetY * gridSize
            const cachedCoord = [
                Math.floor(xcoord / cacheDist) * cacheDist,
                Math.floor(ycoord / cacheDist) * cacheDist,
            ]
            cachedCoord.push((xcoord - cachedCoord[0]) / gridSize)
            cachedCoord.push((ycoord - cachedCoord[1]) / gridSize)
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
            queues.push(`${JSON.stringify(coords)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}|||true`)
        }
        if (cachedCoords.length > 0) {
            cachedQueues.push(`${JSON.stringify(coords)}|||${JSON.stringify(cachedCoords)}|||${gridSize}|||${startNum}|||true`)
        }
    }
    const gen_result_queues = []
    if (!EVENT_EMITTERS[session]) { return }
    const options_gen = {
        filename: path.resolve("./", 'simulations/check_sim_area.js'),
        signal: EVENT_EMITTERS[session]
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

    queues = []

    fs.mkdirSync('temp/' + session)
    fs.writeFileSync(`temp/${session}/info.txt`, JSON.stringify({ createdTime: (new Date()).toISOString() }))
    const obsFile = 'temp/' + session + '/obs.sim'
    console.log('writing file: file_' + session + '.sim')
    fs.writeFileSync(obsFile, await mfn.io.ExportData(null, 'sim'))
    console.log('finished writing file')
    const pgons = mfn.query.Get('pg', null);
    mfn.edit.Delete(pgons, 'delete_selected');
    delete mfn

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
        const genFile = `temp/${session}/f_${i}`
        const threadCoords = gen_result.slice(fromIndex, toIndex)
        fs.writeFileSync(genFile, JSON.stringify(threadCoords))
        queues.push(`${simulationType} ${obsFile} ${genFile} ${gridSize}`)
    }
    console.log('!!! number of tasks:', queues.length)
    if (!EVENT_EMITTERS[session]) { return }
    const options_ex = {
        filename: path.resolve("./", 'simulations/sim_execute.js'),
        signal: EVENT_EMITTERS[session]
    }
    EVENT_EMITTERS[session].setMaxListeners(queues.length)
    await Promise.all(queues.map(x => POOL.run(x, options_ex)))
    if (simulationType === 'wind') {
        const wind_stns = new Set()
        for (let i = 1; i < coords.length; i++) {
            const j = i - 1
            const unitdirvec = new THREE.Vector2(x = coords[i][0] - coords[j][0], y = coords[i][1] - coords[j][1]).normalize().multiplyScalar(gridSize)
            const scaling = Math.abs((coords[i][0] - coords[j][0]) / unitdirvec.x)
            for (let k = 0; k <= scaling; k++) {
                const checkCoord = [i * unitdirvec.x + coords[j][0], i * unitdirvec.y + coords[j][1]]
                const closest_stn = {
                    id: '',
                    dist2: 9999999999
                }
                for (const stn of sg_wind_stn_data) {
                    const distx = stn.coord[0] - checkCoord[0]
                    const disty = stn.coord[1] - checkCoord[1]
                    const dist2 = distx * distx + disty * disty
                    if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
                        closest_stn.id = stn.id
                        closest_stn.dist2 = dist2
                    }
                }
                wind_stns.add(closest_stn.id)
            }
        }
        // for (let i = 0; i < processLimit; i++) {
        //   const wind_stn_file = `temp/${session}/file_${session}_${i}_wind_stns.txt`
        //   if (fs.existsSync(wind_stn_file)) {
        //     const wind_stns_used = fs.readFileSync(wind_stn_file, { encoding: 'utf8', flag: 'r' })
        //     for (const stn of wind_stns_used.split(',')) {
        //       wind_stns.add(stn.trim())
        //     }
        //   }
        // }
        otherInfo.wind_stns = Array.from(wind_stns)
    }
    console.log('________________')
    // combining results
    let compiledResult = []
    for (let i = 0; i < processLimit; i++) {
        try {
            const readfile = `temp/${session}/f_${i}.txt`
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
    const simResult = JSON.parse('[' + compiledResult.join(', \n') + ']')
    for (let i = 0; i < simResult.length; i++) {
        const offsetX = gen_result_index[i] % cols
        const offsetY = Math.floor(gen_result_index[i] / cols)
        const xcoord = limCoords[0] + offsetX * gridSize
        const ycoord = limCoords[1] + offsetY * gridSize
        const cachedCoord = [
            Math.floor(xcoord / cacheDist) * cacheDist,
            Math.floor(ycoord / cacheDist) * cacheDist,
        ]
        cachedCoord.push((xcoord - cachedCoord[0]) / gridSize)
        cachedCoord.push((ycoord - cachedCoord[1]) / gridSize)
        const cachedResultMatch = cachedResult[`${cachedCoord[0]}_${cachedCoord[1]}`]
        if (cachedResultMatch) {
            cachedResultMatch[cachedCoord[2]][cachedCoord[3]] = simResult[i]
        }
    }
    for (const file in cachedResult) {
        fs.writeFileSync(`result/${simulationType}_${gridSize}_${file}`, JSON.stringify(cachedResult[file]))
    }
    return [simResult.concat(cached_result), gen_result_index.concat(cached_result_index), [cols, rows], otherInfo]
}

async function runUploadMobiusSimulation(EVENT_EMITTERS, POOL, reqBody, simulationType, reqSession = null) {
    const session = reqSession ? reqSession : getSession()
    EVENT_EMITTERS[session] = new EventEmitter()
    const { extent, data, simBoundary, featureBoundary, gridSize } = reqBody
    let processLimit = RESOURCE_LIM_DICT[gridSize]
    const otherInfo = {}
    const boundClipper = new Shape([featureBoundary.map(coord => { return { X: coord[0] * 1000000, Y: coord[1] * 1000000 } })])
    boundClipper.fixOrientation()

    const mfn = new SIMFuncs();
    await mfn.io.ImportData(data, 'sim');

    let allObstructions = mfn.query.Get('pg', null)
    if (allObstructions.length === 0) {
        const dummyps = mfn.make.Position([[0, 0, -1], [2, 0, -1], [0, 2, -1]])
        const dummypg = mfn.make.Polygon(dummyps)
        allObstructions = [dummypg]
    }
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

    // console.log('limCoords', limCoords)
    // console.log('coords', coords)
    // console.log('width, height', limCoords[3] - limCoords[1], limCoords[2] - limCoords[0])
    // console.log('rows, cols', (limCoords[3] - limCoords[1]) / gridSize, (limCoords[2] - limCoords[0]) / gridSize)
    const rows = Math.ceil((limCoords[3] - limCoords[1]) / gridSize)
    const cols = Math.ceil((limCoords[2] - limCoords[0]) / gridSize)
    const total = rows * cols
    if (total < processLimit * 10) {
        processLimit = Math.floor(total / 10)
    } else if (processLimit < total / 10000) {
        processLimit = Math.ceil(total / 10000)
    }
    const numCoordsPerThread = Math.ceil(total / processLimit)
    // console.log('rows, cols', rows, cols)
    // console.log('processLimit', processLimit)
    // console.log('numCoordsPerThread', numCoordsPerThread)

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
        queues.push(`${JSON.stringify(coords)}|||${JSON.stringify(simCoords)}|||${gridSize}|||${startNum}`)
    }
    const gen_result_queues = []
    if (!EVENT_EMITTERS[session]) { return }
    const options_gen = {
        filename: path.resolve("./", 'simulations/check_sim_area.js'),
        signal: EVENT_EMITTERS[session]
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

    queues = []

    fs.mkdirSync('temp/' + session)
    const obsFile = 'temp/' + session + '/obs.sim'
    console.log('writing file: file_' + session + '.sim')
    fs.writeFileSync(obsFile, await mfn.io.ExportData(null, 'sim'))
    console.log('finished writing file')
    const pgons = mfn.query.Get('pg', null);
    mfn.edit.Delete(pgons, 'delete_selected');
    delete mfn

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
        const genFile = `temp/${session}/f_${i}`
        const threadCoords = gen_result.slice(fromIndex, toIndex)
        fs.writeFileSync(genFile, JSON.stringify(threadCoords))
        queues.push(`${simulationType} ${obsFile} ${genFile} ${gridSize}`)
    }
    console.log('!!! number of tasks:', queues.length)
    if (!EVENT_EMITTERS[session]) { return }
    const options_ex = {
        filename: path.resolve("./", 'simulations/sim_execute.js'),
        signal: EVENT_EMITTERS[session]
    }
    EVENT_EMITTERS[session].setMaxListeners(queues.length)
    await Promise.all(queues.map(x => POOL.run(x, options_ex)))
    if (simulationType === 'wind') {
        const wind_stns = new Set()
        for (let i = 0; i < processLimit; i++) {
            const wind_stn_file = `temp/${session}/f_${i}_wind_stns.txt`
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
            const readfile = `temp/${session}/f_${i}.txt`
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

module.exports = {
    runMobiusSimulation: runMobiusSimulation,
    runUploadMobiusSimulation: runUploadMobiusSimulation
}
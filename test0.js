const { default: Shape } = require("@doodle3d/clipper-js");
const { skyRays, rayLineIntersect, rayPgonIntersect, iDir, crossProduct, vectorSub, pointInPgon, solarDirs } = require("./simulations_raster/util");

const MAX_DIST = 350
const MAX_DIST_SQR = MAX_DIST * MAX_DIST


// -------------------------------------------------------------------------------------------------
let lat = null
let vecs = null



// function rayPgonIntersect(s, v, pgon) {
//     // const denom = (p2[1] - p1[1]) * v[0] - (p2[0] - p1[0]) * v[1];
//     // return ((p2[0] - p1[0])*(s[1] - p1[1]) - (p2[1] - p1[1])*(s[0] - p1[0]))/denom
// }

function analyze_sensor(sensor, buildings, lines, pgons) {
    // console.log('_________',sensor, lines.length)
    const vecIndex = []
    for (let i = 0; i < vecs.length; i++) { vecIndex.push(null) }

    // check if sensor is directly under a building
    const bCoord = [Math.round(sensor[0] * 10000), Math.round(sensor[1] * 10000)]
    for (const building of buildings) {
        if (building.pointInShape({ X: bCoord[0], Y: bCoord[1] }, false, false)) { return 0 }
        // if (building.pointInShape( { X: sensor[0], Y: sensor[1]}, false, false)) {
        //     return 0
        // }
    }
    const result_max = vecs.reduce((sum, v) => (sum + v[0][2]) , 0) + 1
    let result = result_max
    // check all lines obstruction
    for (const line of lines) {
        // angle of the two line end points from the sensor (clockwise angle from north)
        let [endPt1, endPt2, lineHeight] = line
        let [dir1, angle1] = iDir(sensor, endPt1)
        let [dir2, angle2] = iDir(sensor, endPt2)
        let crossAngleCheck = angle2 - angle1
        if (crossAngleCheck < 0) {
            const temp = [endPt1, dir1, angle1]
            endPt1 = endPt2
            dir1 = dir2
            angle1 = angle2
            endPt2 = temp[0]
            dir2 = temp[1]
            angle2 = temp[2]
            crossAngleCheck = 0 - crossAngleCheck
        }
        for (let i = 0; i < vecIndex.length; i++) {
            if (vecIndex[i]) { continue }
            const [vec3D, vecAngle] = vecs[i]
            if (vecAngle === null) { continue }
            let check = false
            if (crossAngleCheck > 180) {
                if (vecAngle <= angle1 || vecAngle >= angle2) { check = true }
            } else if (vecAngle >= angle1 && vecAngle <= angle2) { check = true }
            if (check) {
                const t = rayLineIntersect(sensor, vec3D, endPt1, endPt2)
                const intsnHeight = vec3D[2] * t
                if (lineHeight < intsnHeight) { continue }
                const distSqr = (vec3D[0] * t) ** 2 + (vec3D[1] * t) ** 2
                if (distSqr > MAX_DIST_SQR) { continue }
                if ((distSqr + intsnHeight * intsnHeight) > MAX_DIST_SQR) { continue }
                vecIndex[i] = [sensor[0] + vec3D[0] * t, sensor[1] + vec3D[1] * t, intsnHeight] 
                result -= vec3D[2]
            }
        }
    }
    let vertVecCheck = true
    for (const pgon of pgons) {
        const pgonNorm = crossProduct(vectorSub(pgon[1], pgon[0]), vectorSub(pgon[2], pgon[0]))
        // if pgon's normal is vertical, check if it covers the sensor
        if (pgonNorm[0] === 0 && pgonNorm[1] === 0 && pgon[0][2] === 0 && pointInPgon([...sensor, 0], pgon, [0, 0, 1])) {
            return 0
        }
        // if pgon is not horizontal, check if it intersects with the vertical ray
        if (vertVecCheck && pgonNorm[2] !== 0) {
            const [intersect, intersectionPt] = rayPgonIntersect([...sensor, 0], [0, 0, 1], pgon, pgonNorm)
            if (intersect) {
                vertVecCheck = intersectionPt
                console.log('_______~~~~1', vecIndex[i])
                result -= 1
            }
        }
        for (let i = 0; i < vecIndex.length; i++) {
            if (vecIndex[i]) { continue }
            const vec3D = vecs[i][0]
            const [intersect, intersectionPt] = rayPgonIntersect([...sensor, 0], vec3D, pgon, pgonNorm)
            if (intersect) {
                vecIndex[i] = intersectionPt
                console.log('_______~~~~2', vecIndex[i])
                result -= vec3D[2]
            }
        }
    }
    return [sensor, vecIndex, result / result_max * 100]
}

// =================================================================================================
/**
 * 
 */
function Solar(lines, pgons, buildings, sensors, gridSize, latitude, taskNum) {
    console.log('starting sky task', taskNum)
    const result = []
    const halfGridSize = gridSize / 2
    if (!lat || !vecs || latitude !== lat) {
        vecs = solarDirs(latitude, 3)
        lat = latitude
    }
    for (const sensor of sensors) {
        try {
            const sensor_result = analyze_sensor([sensor[0] + halfGridSize, sensor[1] + halfGridSize], buildings, lines, pgons)
            if (sensor_result) {
                result.push(sensor_result)
                return sensor_result
                continue
            }
        } catch (ex) {
            console.log('error', ex)
        }
        result.push(0)
    }
    console.log('task finished')
    return result
}


const fs = require('fs');
const { SIMFuncs } = require("@design-automation/mobius-sim-funcs");
const data = fs.readFileSync('test_data.txt', {encoding: 'utf-8'})

async function run() {
    const argv = data.split('|||')
    if (argv.length >= 3) {
        const parsed_argv = argv.map(x => JSON.parse(x))
        const buildings = parsed_argv[2]
        const grid_size = parsed_argv[4]
        const half_grid_size = grid_size / 2
        for (let i = 0; i < buildings.length; i++) {
            buildings[i] = new Shape(buildings[i])
            buildings[i].fixOrientation()
        }
        const r = Solar(...parsed_argv)

        const sim = new SIMFuncs()
        for (const line of parsed_argv[0]) {
            const ps = sim.make.Position([[line[0][0], line[0][1], 0], [line[1][0], line[1][1], 0]])
            const pl = sim.make.Polyline(ps)
            sim.make.Extrude(pl, line[2], 1, 'quads')
        }
        const sensor = r[0]
        const ps_sens = sim.make.Position([
            [sensor[0] - half_grid_size, sensor[1] - half_grid_size, 0],
            [sensor[0] + half_grid_size, sensor[1] - half_grid_size, 0],
            [sensor[0] + half_grid_size, sensor[1] + half_grid_size, 0],
            [sensor[0] - half_grid_size, sensor[1] + half_grid_size, 0],
        ])
        const pg_sens = sim.make.Polygon(ps_sens)
        const ps_o = sim.make.Position([sensor[0], sensor[1], 0])
        const lines = [[], []]
        for (let i = 0; i < vecs.length; i++) {
            if (!r[1][i]) {
                const ps = sim.make.Position([sensor[0] + vecs[i][0][0] * MAX_DIST, sensor[1] + vecs[i][0][1] * MAX_DIST, vecs[i][0][2] * MAX_DIST])
                const pl = sim.make.Polyline([ps_o, ps])
                lines[0].push(pl)
            } else {
                const ps = sim.make.Position(r[1][i])
                const pl = sim.make.Polyline([ps_o, ps])
                lines[1].push(pl)
            }
        }
        const __model__ = sim.__model__
        __model__.modeldata.attribs.set.setModelAttribVal('line_mat', {
            "type": "LineDashedMaterial",
            "color": [1,1,1],
            "vertexColors": 1,
            "dashSize": 0,
            "gapSize": 0,
            "scale": 1
        });
        __model__.modeldata.attribs.add.addAttrib(6, 'material', 'string');
        __model__.modeldata.attribs.add.addAttrib(1, 'rgb', 'list');
        
        sim.visualize.Color(lines[0], [0,1,0])
        sim.attrib.Set(lines[0], 'material', 'line_mat')

        sim.visualize.Color(lines[1], [1,0,0])
        sim.attrib.Set(lines[1], 'material', 'line_mat')
        await sim.io.ImportData(fs.readFileSync('testsim.sim', {encoding: 'utf-8'}), 'sim');
        fs.writeFileSync('test1.sim', await sim.io.ExportData(null, 'sim'))
    }    
}

run()
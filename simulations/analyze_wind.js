const sg_stn_data = require('./sg_wind_station_data.js').sg_wind_stn_data;
const Shape = require('@doodle3d/clipper-js').default;
const Jimp = require('jimp');
const fs = require('fs');
const { sg_wind } = require('./sg_wind_all.js');

if (fs.existsSync('./test')) {
    fs.rmSync('./test', {recursive: true, force: true})
}
fs.mkdirSync('./test')


const NORM_SCALING = 1
const MAX_OBS_TOL = 0

const WIND_DIR_VECS = []
for (let i = 0; i < 16; i++) {
    const angle = i * 22.5 * Math.PI / 180
    cs = Math.cos(angle);
    sn = Math.sin(angle);

    const x = sn * 0.5;
    const y = cs * 0.5;
    WIND_DIR_VECS.push([x,y])
}
const MIN_WIND_DIST = 10 / 0.5

// =================================================================================================
/**
 * Calculate an approximation of the wind frequency for a set sensors positioned at specified 
 * locations. 
 */
function Wind(sensors, raster_data, wind_rose, radius, layers) {
    const minCoord = raster_data[-1]
    const results0 = []
    const baseRaster = raster_data[layers[0]]
    const radiusSqr = radius * radius
    const total_area = radiusSqr * Math.PI
    console.log('WIND ROSE', wind_rose)
    for (const sensor of sensors) {
        console.log('_____ sensor',sensor)

        const imageData = []
        const imageObsData = []
        for (let x = 0; x < baseRaster.length; x++) {
            const col = []
            const col1 = []
            for (let y = 0; y < baseRaster[0].length; y++) {
                col.push(null)
                col1.push(null)
            }
            imageData.push(col)
            imageObsData.push(col1)
        }

        let sensor_result = 0
        const frontalAreas = []
        const sensorXY = [
            Math.floor(sensor[0][0]) - minCoord[0],
            Math.floor(sensor[0][1]) - minCoord[1],
        ]
        if (Number.isInteger(sensor[0][0])) {
            if (baseRaster[sensorXY[0]][sensorXY[1]] &&
                baseRaster[sensorXY[0]-1][sensorXY[1]] &&
                baseRaster[sensorXY[0]-1][sensorXY[1]-1] &&
                baseRaster[sensorXY[0]][sensorXY[1]-1]) {
                results0.push(0)
                continue
            }
        } else {
            if (baseRaster[sensorXY[0]][sensorXY[1]]) {
                results0.push(0)
                continue
            }
        }
        let areaCount = 0
        for (let x = sensorXY[0] - radius - 1; x < sensorXY[0] + radius + 1; x++) {
            for (let y = sensorXY[1] - radius - 1; y < sensorXY[1] + radius + 1; y++) {
                const coord = [x + minCoord[0] + 0.5, y + minCoord[1] + 0.5]
                const xdiff = coord[0] - sensor[0][0]
                const ydiff = coord[1] - sensor[0][1]
                const distSqr = xdiff * xdiff + ydiff * ydiff
                if (distSqr > radiusSqr) { continue }
                if (!baseRaster[x][y]) { continue }
                if (distSqr === 0 ) {
                    
                }
                let dirAngle = Math.atan2(xdiff, ydiff) * 180 / Math.PI
                if (dirAngle < -10) {
                    dirAngle += 360
                }
                const freqIndex = Math.floor((dirAngle + 10) / 22.5)
                const freqVal = wind_rose[freqIndex]
                const dist = Math.sqrt(distSqr)
                const dirVecNorm = [xdiff * NORM_SCALING / dist, ydiff * NORM_SCALING / dist]

                for (let h = layers[0]; h < layers[1]; h += layers[2]) {
                    if (!raster_data[h][x][y]) { continue }
                    const numAdd = Math.floor(dist / NORM_SCALING)
                    let obstructionCount = 0
                    const existingCoord= {}
                    for (let i = 0; i <= numAdd; i++) {
                        const pixelX = Math.floor(sensor[0][0] + i * dirVecNorm[0] - minCoord[0])
                        const pixelY = Math.floor(sensor[0][1] + i * dirVecNorm[1] - minCoord[1])
                        if (pixelX === x && pixelY === y) { break; }
                        if (existingCoord[`${pixelX}_${pixelY}`]) { continue}
                        existingCoord[`${pixelX}_${pixelY}`] = true
                        if (raster_data[h][pixelX][pixelY]) {
                            imageObsData[pixelX][pixelY] = true
                            obstructionCount += 1
                            if (obstructionCount > MAX_OBS_TOL) {
                                break
                            }
                        }
                    }
                    if (obstructionCount <= MAX_OBS_TOL) {
                        areaCount += 1
                        let weighted_frontal_area = 0
                        for (let dirIndex = 0; dirIndex < WIND_DIR_VECS.length; dirIndex++) {
                            const windDir = WIND_DIR_VECS[dirIndex]
                            let obst = 0
                            for (let c = 1; c < MIN_WIND_DIST + 1; c++) {
                                const wCoord = [
                                    Math.floor(windDir[0] * c + coord[0]) - minCoord[0],
                                    Math.floor(windDir[1] * c + coord[1]) - minCoord[1],
                                ]
                                if (wCoord[0] === x && wCoord[1] === y) { continue; }
                                if (baseRaster[wCoord[0]][wCoord[1]]) {
                                    obst += 1
                                    if (obst > MAX_OBS_TOL) {
                                        break
                                    }
                                }
                            }
                            if (obst > MAX_OBS_TOL) {
                                weighted_frontal_area += wind_rose[dirIndex]
                            }
                        }
                        // weighted_frontal_area = freqVal
                        const distance_coefficient = (radius - dist) / radius
                        const r = distance_coefficient * distance_coefficient * weighted_frontal_area /total_area
                        sensor_result += r
                        imageData[x][y] = true
                    }
                    break; // -------------------- TEST --------------------
                }
            }
        }
        console.log('')
        console.log('sensor_result, areaCount, total_area')
        console.log(sensor_result, areaCount, total_area)
        const FAD = (sensor_result / total_area)
        console.log('_ FAD:', FAD)
        const VR = -1.64 * FAD + 0.28
        console.log('_ VR:', VR)
        results0.push(VR)

        new Jimp(imageData.length, imageData[0].length, function (err, image) {
            if (err) throw err;
            for (let x = 0; x < imageData.length; x++) {
                for (let y = 0; y < imageData[x].length; y++) {
                    if (imageData[x][y]) {
                        image.setPixelColor(Jimp.rgbaToInt(0, 255, 0, 255), x, imageData[x].length - y - 1)
                    } else if (baseRaster[x][y]){
                        image.setPixelColor(Jimp.rgbaToInt(100, 100, 100, 255), x, imageData[x].length - y - 1)
                    } else {
                        image.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, imageData[x].length - y - 1)
                    }
                }
            }
            const sC = [Math.floor(sensor[0][0]) - minCoord[0], imageData[0].length - Math.floor(sensor[0][1]) + minCoord[1] - 1]
            image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), sC[0], sC[1])
            image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), sC[0]-1, sC[1]-1)
            image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), sC[0]-1, sC[1]+1)
            image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), sC[0]+1, sC[1]-1)
            image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), sC[0]+1, sC[1]+1)
            image.write(`test/test_${performance.now()}__${sensor[0][0]}_${sensor[0][1]}.png`, (err) => {
                if (err) throw err;
            });
        });



    }
    // for (const sensor of sensors) {
    //     results0.push(0.15)
    // }
    // return the results
    return results0;
}

function SplitWeatherStn(sim, sens_rays, sens_pgons) {
    // split sensors into groups based on their closest weather stations
    const closest_stns = {}
    const result_indexing = []
    for (let i = 0; i < sens_pgons.length; i++) {
        const sens_pos = sim.query.Get('ps', sens_pgons[i])
        const pos_coords = sim.attrib.Get(sens_pos, 'xyz')
        const mid_point = pos_coords.reduce((coord_sum, coord) => {
            coord_sum[0] += coord[0];
            coord_sum[1] += coord[1];
            return coord_sum
        }, [0,0]).map(x => x / pos_coords.length)

        let closest_stn = {id: 'S24', dist2: null}
        for (const stn of sg_stn_data) {
            const distx = stn.coord[0] - mid_point[0]
            const disty = stn.coord[1] - mid_point[1]
            const dist2 = distx * distx + disty * disty
            if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
                closest_stn.id = stn.id
                closest_stn.dist2 = dist2
            }
        }
        if (!closest_stns[closest_stn.id]) {
            closest_stns[closest_stn.id] = {
                sens_pgons: [],
                sens_rays: [],
                result: null
            }
        }
        result_indexing.push([closest_stn.id, closest_stns[closest_stn.id].sens_pgons.length])
        closest_stns[closest_stn.id].sens_pgons.push(sens_pgons[i])
        closest_stns[closest_stn.id].sens_rays.push(sens_rays[i])
    }
    return { closest_stns, result_indexing }

}
function SimToRaster(sim, layers) {
    const raster_data = {}
    const all_obstructions = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'obstruction')
    const all_pos = sim.query.Get('ps', all_obstructions)
    const all_pos_xyz = sim.attrib.Get(all_pos, 'xyz')
    const minmax = [9999999, 9999999, -9999999, -9999999]
    for (const xyz of all_pos_xyz) {
        minmax[0] = Math.min(xyz[0], minmax[0])
        minmax[1] = Math.min(xyz[1], minmax[1])
        minmax[2] = Math.max(xyz[0], minmax[2])
        minmax[3] = Math.max(xyz[1], minmax[3]) 
    }
    minmax[0] = Math.floor(minmax[0])
    minmax[1] = Math.floor(minmax[1])
    minmax[2] = Math.ceil(minmax[2])
    minmax[3] = Math.ceil(minmax[3])
    raster_data[-1] = minmax
    for (let h = layers[0]; h < layers[1]; h += layers[2]) {
        raster_data[h] = []
        for (let x = minmax[0]; x < minmax[2]; x++) {
            const col = []
            for (let y = minmax[1]; y < minmax[3]; y++) {
                col.push(null)
            }
            raster_data[h].push(col)
        }

        const obstructions = sim.query.Filter(sim.query.Filter(all_obstructions, 'height_max', '>=', h), 'height_min', '<=', h)
        for (const obstruction of obstructions) {
            const obstruction_xyz = sim.attrib.Get(sim.query.Get('ps', obstruction), 'xyz')
            const boundingBox = sim.calc.BBox(obstruction)
            const obsShape = new Shape([obstruction_xyz.map(coord => { 
                return { X: Math.round(coord[0] * 100), Y: Math.round(coord[1] * 100) } 
            })])
            obsShape.fixOrientation()
            for (let x = Math.floor(boundingBox[1][0]); x < Math.floor(boundingBox[2][0]); x++) {
                for (let y = Math.floor(boundingBox[1][1]); y < Math.ceil(boundingBox[2][1]); y++) {
                    const check = obsShape.pointInShape( { X: x * 100 + 50, Y: y * 100 + 50 }, false, false)
                    if (check) {
                        raster_data[h][x - minmax[0]][y - minmax[1]] = true
                    }
                }
            }
        }
          
        const midCoord = [raster_data[h].length / 2, raster_data[h][0].length / 2]
        const windrose = sg_wind['S102']
        const maxwind = Math.max(...windrose)
        for (let i = 0; i < windrose.length; i++) {
            windrose[i] = windrose[i] / maxwind
        }
        // new Jimp(raster_data[h].length, raster_data[h][0].length, function (err, image) {
        //     if (err) throw err;
        //     for (let x = 0; x < raster_data[h].length; x++) {
        //         for (let y = 0; y < raster_data[h][x].length; y++) {
        //             if (raster_data[h][x][y]) {
        //                 const xdiff = x - midCoord[0]
        //                 const ydiff = y - midCoord[1]
        //                 let dirAngle = Math.atan2(xdiff, ydiff) * 180 / Math.PI
        //                 if (dirAngle < -10) {
        //                     dirAngle += 360
        //                 }
        //                 const freqIndex = Math.floor((dirAngle + 10) / 22.5)
        //                 const r = (freqIndex < 8) ? Math.round((8 - freqIndex) * 255 / 8) : 0
        //                 const g = (freqIndex >= 8) ? Math.round((16 - freqIndex) * 150 / 8) : Math.round((freqIndex) * 150 / 8)
        //                 const b = (freqIndex >= 8) ? Math.round((freqIndex - 8) * 255 / 8) : 0

        //                 // const freqV = windrose[freqIndex] * 2
        //                 // const r = windrose[freqIndex] * 90 + 75
        //                 // const g = windrose[freqIndex] * 90 + 75
        //                 // const b = windrose[freqIndex] * 90 + 75
        //                 // const r = (freqV <= 1) ? Math.round((1 - freqV) * 255) : 0
        //                 // const g = (freqV >= 1) ? Math.round((2 - freqV) * 150) : Math.round((freqV) * 150)
        //                 // const b = (freqV >= 1) ? Math.round((freqV - 1) * 255) : 0
        //                 // if (dirAngle < 0) {
        //                 //     dirAngle += 360
        //                 // }
        //                 // const r = (dirAngle <= 180) ? Math.round((180 - dirAngle) * 255 / 180) : 0
        //                 // const g = (dirAngle >= 180) ? Math.round((360 -dirAngle) * 150 / 180) : Math.round((dirAngle) * 150 / 180)
        //                 // const b = (dirAngle >= 180) ? Math.round((dirAngle - 180) * 255 / 180) : 0
        //                 image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, raster_data[h][x].length - y - 1)
        //             } else {
        //                 image.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, raster_data[h][x].length - y - 1)
        //             }
        //         }
        //     }
        //     image.write(`test/test_${performance.now()}_${h}.png`, (err) => {
        //         if (err) throw err;
        //     });
        // });
    }
    return raster_data
}
function WindPrep(sim, sens_rays, sens_pgons, layers) {
    const {closest_stns, result_indexing} = SplitWeatherStn(sim, sens_rays, sens_pgons)
    const raster_data = SimToRaster(sim, layers)
    return {
        closest_stns: closest_stns,
        result_indexing: result_indexing,
        raster_data: raster_data
    }
}

// =================================================================================================
module.exports = {
    Wind: Wind,
    WindPrep: WindPrep
}
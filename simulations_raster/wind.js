const Shape = require('@doodle3d/clipper-js').default;
const Jimp = require('jimp');
const fs = require('fs');

const BUFFER_AREA_DIST = 250
const BUFFER_AREA_DIST_SQR = BUFFER_AREA_DIST * BUFFER_AREA_DIST
const TOTAL_AREA = BUFFER_AREA_DIST_SQR * Math.PI
const DEG_INTERVAL = 0.25
const ANGLE_INTERVAL = DEG_INTERVAL * Math.PI / 180
const ANGLE_INTERVAL_NUM = Math.round(360 / DEG_INTERVAL)
const COEFFICIENT_FACTOR = 2
const TOLERANCE = 3


function analyze_sensor(sensor, fa_mask, bd_mask, sim_mask, fa_bottom_left, sim_bottom_left, grid_size) {
    // 1x1
    const fa_pos = [
        sensor[0] - fa_bottom_left[0] + grid_size / 2,
        fa_bottom_left[1] - sensor[1] - grid_size / 2,
    ]

    const fa_pos_int = [
        Math.floor(fa_pos[0]),
        Math.floor(fa_pos[1]),
    ]
    // console.log(sensor, fa_bottom_left, fa_pos)
    // console.log('___',Math.round(bd_mask[fa_pos_int[1]][fa_pos_int[0]]) > 0)

    // if (grid_size % 2 == 0) {
    //     if (bd_mask[fa_pos_int[1]][fa_pos_int[0]] && bd_mask[fa_pos_int[1]][fa_pos_int[0] + 1] &&
    //         bd_mask[fa_pos_int[1] + 1][fa_pos_int[0]] && bd_mask[fa_pos_int[1] + 1][fa_pos_int[0] + 1]) { return 0 }
    // } else {
    //     if (bd_mask[fa_pos_int[1]][fa_pos_int[0]]) { return 0 }
    // }
    if ( bd_mask[fa_pos_int[1]][fa_pos_int[0]] > 0 ) { return 0 }

    let area_count = 0
    const pixel_check = {}
    let dir_count = 0
    let sensor_result = 0

    for (let x = fa_pos_int[0] - 201; x < fa_pos_int[0] + 202; x ++) {
        for (let y = fa_pos_int[1] - 201; y < fa_pos_int[1] + 202; y ++) {
            if (x < 0 || y < 0 || x >= fa_mask[0].length || y >= fa_mask.length) { continue }
            if (!fa_mask[y][x] || fa_mask[y][x] < 0) { continue }
            const xdir = x + 0.5 - fa_pos[0]
            const ydir = y + 0.5 - fa_pos[1]
            const dist_sqr = xdir * xdir + ydir * ydir
            if (dist_sqr > BUFFER_AREA_DIST_SQR) { continue }
            const dist = Math.sqrt(dist_sqr)
            const weighted_frontal_area = fa_mask[y][x]
            const distance_coefficient = ((BUFFER_AREA_DIST - dist) / BUFFER_AREA_DIST) ** COEFFICIENT_FACTOR
            // const distance_coefficient = (BUFFER_AREA_DIST_SQR - ndist_sqr) / BUFFER_AREA_DIST_SQR
            const r = distance_coefficient * weighted_frontal_area
            sensor_result += r
            // pixel_check[pos_str] = 255
        }
    
    }
    area_count = TOTAL_AREA


    // for (let angle_interval_index = 0; angle_interval_index < ANGLE_INTERVAL_NUM; angle_interval_index ++) {
    //     dir_count += 1
    //     const angle = ANGLE_INTERVAL * angle_interval_index
    //     const x = Math.sin(angle)
    //     const y = Math.cos(angle)
    //     const fa_x_unit = x / 4
    //     const fa_y_unit = y / 4
    //     let check = TOLERANCE
    //     let prev_XY = null
    //     const pixel_offset = [0, 0]
    //     if (x < 0) { pixel_offset[0] = 1 }
    //     if (y < 0) { pixel_offset[1] = 1 }

    //     for (let n = 0; n < BUFFER_AREA_DIST * 20; n++) {
    //         const scaling = n + 0.1
    //         const n_x = Math.floor(fa_pos[0] + fa_x_unit * scaling)
    //         const n_y = Math.floor(fa_pos[1] + fa_y_unit * scaling)
    //         if (n_x < 0 || n_y < 0 || n_x >= fa_mask[0].length || n_y >= fa_mask.length) { break }
    //         if (!prev_XY) {
    //             prev_XY = [n_x, n_y]
    //         } else if (prev_XY[0] === n_x && prev_XY[1] === n_y) {
    //             continue
    //         } else {
    //             prev_XY[0] = n_x
    //             prev_XY[1] = n_y
    //         }
    //         const fa_nx_dir = n_x + pixel_offset[0] - fa_pos[0]
    //         const fa_ny_dir = n_y + pixel_offset[1] - fa_pos[1]
    //         const ndist_sqr = fa_nx_dir * fa_nx_dir + fa_ny_dir * fa_ny_dir


    //         if (ndist_sqr > BUFFER_AREA_DIST_SQR) { break }
    //         const pos_str = n_x + '_' + n_y



    //         if (pixel_check[pos_str]) {
    //             if (check && bd_mask[n_y][n_x] > 0) {
    //                 if (fa_mask[n_y][n_x] > 0 && pixel_check[pos_str] != 255) {
    //                     const weighted_frontal_area = fa_mask[n_y][n_x]
    //                     const ndist = Math.sqrt(ndist_sqr)
    //                     const distance_coefficient = ((BUFFER_AREA_DIST - ndist) / BUFFER_AREA_DIST) ** COEFFICIENT_FACTOR
    //                     // const distance_coefficient = (BUFFER_AREA_DIST_SQR - ndist_sqr) / BUFFER_AREA_DIST_SQR
    //                     const r = distance_coefficient * weighted_frontal_area
    //                     sensor_result += r
    //                     pixel_check[pos_str] = 255
    //                 }
    //                 check -= 1
    //                 if (check == 0) { break }
    //             }
    //             continue

    //         }
    //         if (fa_mask[n_y][n_x] > 0) {
    //             pixel_check[pos_str] = 40
    //         } else {
    //             pixel_check[pos_str] = 20
    //         }
    //         if (check) {
    //             area_count += 1
    //             pixel_check[pos_str] = 120
    //             if (bd_mask[n_y][n_x] <= 0) { continue }
    //             if (!fa_mask[n_y][n_x]) {
    //                 check -= 1
    //                 area_count -= 1
    //                 pixel_check[pos_str] = 70
    //                 continue
    //             }
    //             const weighted_frontal_area = fa_mask[n_y][n_x]
    //             const ndist = Math.sqrt(ndist_sqr)
    //             const distance_coefficient = ((BUFFER_AREA_DIST - ndist) / BUFFER_AREA_DIST) ** COEFFICIENT_FACTOR
    //             // const distance_coefficient = (BUFFER_AREA_DIST_SQR - ndist_sqr) / BUFFER_AREA_DIST_SQR
    //             const r = distance_coefficient * weighted_frontal_area
    //             sensor_result += r
    //             pixel_check[pos_str] = 255
    //             check -= 1
    //             if (check == 0) { break }
    //         }

    //     }
    // }
    let missing_count = 0

    // const image = new Jimp(fa_mask[0].length, fa_mask.length);
    // for (const i in pixel_check) {
    //     const pos = i.split('_').map(x => Number(x))
    //     const v = Number(pixel_check[i])
    //     image.setPixelColor(Jimp.rgbaToInt(v, v, v, 255), pos[0], pos[1])
    // }
    // image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), fa_pos[0], fa_pos[1])
    // image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), fa_pos[0]-1, fa_pos[1]-1)
    // image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), fa_pos[0]-1, fa_pos[1]+1)
    // image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), fa_pos[0]+1, fa_pos[1]-1)
    // image.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), fa_pos[0]+1, fa_pos[1]+1)
    // console.log('_________________________')
    // image.write(`test/test_${fa_pos[0]}_${fa_pos[1]}.png`, (err) => {
    //     if (err) throw err;
    // });

    const FAD = sensor_result / area_count
    // return FAD
    // console.log('___ FAD:', FAD, '; dir_count:', dir_count, '; missing_count:', missing_count, '; time taken:', (performance.now() - start) / 1000)
    let VR = -1.64 * FAD + 0.28
    if (VR < 0) {VR = 0}
    VR = Math.round(VR * 10000000) / 10000000
    return VR

}


// =================================================================================================
/**
 * Calculate an approximation of the wind frequency for a set sensors positioned at specified 
 * locations. 
 */
function Wind(sensors, fa_mask, bd_mask, sim_mask, fa_bottom_left, sim_bottom_left, grid_size) {
    const result = []

    for (const sensor of sensors) {
        try {
            const sensor_result = analyze_sensor(sensor, fa_mask, bd_mask, sim_mask, fa_bottom_left, sim_bottom_left, grid_size)
            if (sensor_result) {
                result.push(sensor_result)
                continue
            }
        } catch(ex) {
            console.log('error', ex)
        }
        result.push(0)
    }

    return result
}


module.exports = (content) => {
    const argv = content.split('|||')
    if (argv.length >= 7) {
        const parsed_argv = argv.map(x => JSON.parse(x))
        return Wind(...parsed_argv)
    }
}

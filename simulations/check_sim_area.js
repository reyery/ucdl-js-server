const Shape = require('@doodle3d/clipper-js').default;

const SCALE = 100000
function preprocessFn(list, halfGridSize = null) {
    if (list.length === 0) { return }
    if (Array.isArray(list[0])) {
        for (const childList of list) {
            preprocessFn(childList)
        }
        return
    } else {
        for (let i = 0; i < list.length; i++) {
            if (list[i] === null) { continue }
            if (halfGridSize) {
                list[i] = list[i] + halfGridSize
            }
            list[i] = Math.round(list[i] * SCALE)
        }
    }
}
function check_sim(bound_coords, sim_coord_list1, sim_coord_list2, halfGridSize, offset_index) {
    preprocessFn(bound_coords)
    preprocessFn(sim_coord_list2, halfGridSize)
    let boundClipper = new Shape([bound_coords.map(coord => {return {X: coord[0], Y: coord[1]}})])
    boundClipper.fixOrientation()
    boundClipper = boundClipper.offset(halfGridSize * SCALE, {
        jointType: 'jtSquare',
        endType: 'etClosedPolygon',
        miterLimit: 0,
        roundPrecision: 0.25
    })
    const result = []
    const result_index = []
    for (let i = 0; i < sim_coord_list2.length; i++) {
        const coord = sim_coord_list2[i]
        if (coord[0] === null) { continue } 
        const check = boundClipper.pointInShape( { X: coord[0], Y: coord[1] }, false, false)
        if (check) {
            result.push(sim_coord_list1[i])
            result_index.push(i + offset_index)
        }
    }
    return [result, result_index]
}

module.exports = (content) => {
    const argv = content.split('|||')
    const bound_coords = JSON.parse(argv[0])
    const sim_coord_list1 = JSON.parse(argv[1])
    const sim_coord_list2 = JSON.parse(argv[1])
    const gridsize = Number.parseInt(argv[2]) / 2
    const offset_index = Number.parseInt(argv[3])
    if (bound_coords && sim_coord_list1) {
        return check_sim(bound_coords, sim_coord_list1, sim_coord_list2, gridsize, offset_index)
    }
}

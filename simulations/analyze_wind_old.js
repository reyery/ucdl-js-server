const {
    arrMakeFlat,
    createSingleMeshBufTjs,
    idsBreak,
    vecAdd,
    vecDot,
    vecMult,
    vecCross,
    vecNorm,
    isRay,
    isPlane
} = require('@design-automation/mobius-sim')
const THREE = require('three');



const EPS = 1e-6;

function _getSensorRays(sensors, offset) {
    const is_ray = isRay(sensors[0]);
    const is_pln = isPlane(sensors[0]);
    if (!is_ray && !is_pln) {
        const sensors_lists = sensors;
        const rays_lists = [];
        for (const sensors_list of sensors_lists) {
            const rays = _getSensorRaysFromList(sensors_list, offset);
            rays_lists.push(rays);
        }
        return [
            _getSensorRaysFromList(sensors_lists[0], offset),
            _getSensorRaysFromList(sensors_lists[1], offset),
            true
        ];
    }
    const sensors_list = sensors;
    return [_getSensorRaysFromList(sensors_list, offset), [], false];
}
function _getSensorRaysFromList(sensors, offset) {
    const rays = [];
    const is_ray = isRay(sensors[0]);
    const is_pln = isPlane(sensors[0]);
    for (const origin of sensors) {
        let origin_xyz = null;
        let dir_xyz = null;
        if (is_ray) {
            origin_xyz = origin[0];
            dir_xyz = vecNorm(origin[1]);
        } else if (is_pln) {
            origin_xyz = origin[0];
            dir_xyz = vecCross(origin[1], origin[2]);
        } else {
            throw new Error("Sensor has invalid values");
        }
        const origin_offset_xyz = vecAdd(origin_xyz, vecMult(dir_xyz, offset));
        rays.push([origin_offset_xyz, dir_xyz]);
    }
    return rays;
}


// =================================================================================================
/**
 * Calculate an approximation of the wind frequency for a set sensors positioned at specified 
 * locations. 
 * \n
 * @param __model__
 * @param sensors A list of Rays or a list of Planes, to be used as the 
 * sensors for calculating wind.
 * @param entities The obstructions, polygons, or collections of polygons.
 * @param radius The max distance for raytracing.
 * @param num_rays An integer specifying the number of rays to generate in each wind direction.
 * @param layers Three numbers specifying layers of rays, as [start, stop, step] relative to the 
 * sensors.
 * @returns A dictionary containing wind results.
 */
function Wind(__model__, sensors, entities, radius, num_rays, layers) {
    entities = arrMakeFlat(entities);
    let ents_arrs = idsBreak(entities);
    radius = Array.isArray(radius) ? radius : [1, radius];
    layers = Array.isArray(layers) ? layers : [0, layers, 1]; // start, end, step_size
    if (layers.length === 2) { layers = [layers[0], layers[1], 1]; }
    // get rays for sensor points
    const [sensors0, sensors1, two_lists] = _getSensorRays(sensors, 0.01); // offset by 0.01
    // create mesh
    const [mesh_tjs, _] = createSingleMeshBufTjs(__model__, ents_arrs);
    // get the wind rose
    const wind_rose = __model__.modeldata.attribs.get.getModelAttribVal("wind");
    // get the direction vectors for shooting rays
    const dir_vecs = _windVecs(num_rays + 1, wind_rose);
    // run simulation
    const results0 = _calcWind(__model__,
        sensors0, dir_vecs, radius, mesh_tjs, layers, wind_rose, false);
    // cleanup
    mesh_tjs.geometry.dispose();
    (mesh_tjs.material).dispose();
    // return the results
    return results0;
}
// =================================================================================================
function _calcWind(
    __model__,
    sensor_rays,
    dir_vecs,
    radius,
    mesh_tjs,
    layers,
    wind_rose,
    generate_lines
) {
    const results = [];
    const num_layers = Math.round((layers[1] - layers[0]) / layers[2]);
    // create tjs objects (to be resued for each ray)
    const sensor_tjs = new THREE.Vector3();
    const dir_tjs = new THREE.Vector3();
    const ray_tjs = new THREE.Raycaster(sensor_tjs, dir_tjs, radius[0], radius[1]);
    // shoot rays
    for (const [sensor_xyz, sensor_dir] of sensor_rays) {
        let sensor_result = 0;
        // loop through vertical layers
        for (let z = layers[0]; z < layers[1]; z += layers[2]) {
            // save start
            const ray_start = [sensor_xyz[0], sensor_xyz[1], sensor_xyz[2] + z];
            sensor_tjs.x = ray_start[0]; sensor_tjs.y = ray_start[1]; sensor_tjs.z = ray_start[2];
            // loop through wind directions
            for (let i = 0; i < wind_rose.length; i++) {
                const wind_freq = wind_rose[i] / (dir_vecs[i].length * num_layers);
                // loop through dirs
                for (const ray_dir of dir_vecs[i]) {
                    // check if target is behind sensor
                    const dot_ray_sensor = vecDot(ray_dir, sensor_dir);
                    if (dot_ray_sensor < -EPS) { continue; }
                    // set raycaster direction
                    dir_tjs.x = ray_dir[0]; dir_tjs.y = ray_dir[1]; dir_tjs.z = ray_dir[2];
                    // shoot raycaster
                    const isects = ray_tjs.intersectObject(mesh_tjs, false);
                    // get results
                    if (isects.length === 0) {
                        // if no intersection => distance ratio is 1
                        // add wind_frequency to the result
                        sensor_result += wind_freq; // dist_ratio is 1
                    } else {
                        // distance ratio: intersection distance / radius
                        // i.e. intersection at 50m over a 200m radius => distance ratio = 0.25
                        const dist_ratio = isects[0].distance / radius[1];
                        // add wind_frequency * distance ratio to the result
                        sensor_result += (wind_freq * dist_ratio);
                    }
                }
            }
        }
        results.push(sensor_result)
        // generate calculation lines for each sensor
    }
    return { wind: results };
}
// =================================================================================================
function _windVecs(num_vecs, wind_rose) {
    // num_vecs is the number of vecs for each wind angle
    const num_winds = wind_rose.length;
    const wind_ang = (Math.PI * 2) / num_winds;
    const ang_inc = wind_ang / num_vecs;
    const ang_start = -(wind_ang / 2) + (ang_inc / 2);
    const dir_vecs = [];
    for (let wind_i = 0; wind_i < num_winds; wind_i++) {
        const vecs_wind_dir = [];
        for (let vec_i = 0; vec_i < num_vecs; vec_i++) {
            const ang = ang_start + (wind_ang * wind_i) + (ang_inc * vec_i);
            vecs_wind_dir.push([Math.sin(ang), Math.cos(ang), 0]);
        }
        dir_vecs.push(vecs_wind_dir);
    }
    // returns a nest list, with vectors groups according to the wind direction
    // e.g. if there are 16 wind directions, then there will be 16 groups of vectors
    return dir_vecs;
}
// =================================================================================================
module.exports = {
    Wind: Wind
}
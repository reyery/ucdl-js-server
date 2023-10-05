const THREE = require("three");
const proj4 = require('proj4');

const XAXIS = new THREE.Vector3(1, 0, 0);
const YAXIS = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

//=========================================================================//
//=========================================================================//
//=========================== SKY FUNCTIONS =============================//
//=========================================================================//
//=========================================================================//

// -------------------------------------------------------------------------------------------------
// https://www.researchgate.net/publication/245385073_Subdivision_of_the_sky_hemisphere_for_luminance_measurements
// https://drajmarsh.bitbucket.io/cie-sky.html
// The Reinhart/Tregenza subdivision of the sky dome are based on
// integer subdivisions of each of the original 145 patches.
// 2 deg, 48 bands, 5220 points
// 3 deg, 32 bands, 2320 points
// 4 deg, 24 bands, 1303 points (andrew marsh calculates 1305, not sure why)
// 6 deg, 16 bands, 580 points
// 12 deg, 8 bands, 145 points
function tregenzaSky(detail) {
    const alt_inc = [12, 6, 4, 3, 2][detail];
    const repeat = [1, 2, 3, 4, 6][detail];
    const divs = [30, 30, 24, 24, 18, 12, 6];
    let alt = alt_inc / 2;
    const vecs = [];
    // create the dome
    for (let i = 0; i < repeat * 7; i++) {
        const num_points = divs[Math.floor(i / repeat)] * repeat;
        _skyRayDirsTjsCircle(num_points, alt, vecs);
        alt += alt_inc;
    }
    // add some points to the apex, following the Reinhart subdivision method
    if (detail === 0) {
        vecs.push([0, 0, 1]);
        return vecs;
    }
    if (detail === 1) {
        _skyRayDirsTjsCircle(4, 87, vecs);
        return vecs;
    }
    if (detail === 2) {
        _skyRayDirsTjsCircle(6, 86, vecs);
        vecs.push([0, 0, 1]);
        return vecs;
    }
    if (detail === 3) {
        _skyRayDirsTjsCircle(8, 85.5, vecs);
        _skyRayDirsTjsCircle(8, 88.5, vecs);
        return vecs;
    }
    if (detail === 4) {
        _skyRayDirsTjsCircle(12, 85, vecs);
        _skyRayDirsTjsCircle(12, 87, vecs);
        _skyRayDirsTjsCircle(12, 89, vecs);
        return vecs;
    }

}
// -------------------------------------------------------------------------------------------------
// altitude in degrees, 0 is on ground 90 is apex
function _skyRayDirsTjsCircle(num_points, alt, vecs) {
    alt = (90 - alt) * (Math.PI / 180);
    const rad = Math.sin(alt);
    const z = Math.cos(alt);
    const ang_inc = (2 * Math.PI) / num_points;
    const ang_start = ang_inc / 2;
    for (let i = 0; i < num_points; i++) {
        const x = rad * Math.sin(ang_start + (ang_inc * i));
        const y = rad * Math.cos(ang_start + (ang_inc * i));
        vecs.push([x, y, z]);
    }
}
// -------------------------------------------------------------------------------------------------

function genSkyRays(num = 1) {
    const vecs3D = tregenzaSky(num)
    const vecs = vecs3D.reduce((arr, v) => {
        // const v_len = Math.sqrt(v[0] * v[0] + v[1] * v[1])
        if (v[2] < 0) { return arr }
        if (v[0] === 0 && v[1] === 0) { 
            arr.push([v, null])
            return arr
        }
        let a = Math.atan2(v[0], v[1]) * 180 / Math.PI
        if (a < 0) { a += 360 }
        arr.push([v, a])
        return arr
    }, [])
    vecs.sort((a, b) => {
        return a[1] - b[1]
    })
    return vecs
}

const skyRays = genSkyRays()





//=========================================================================//
//=========================================================================//
//=========================== SOLAR FUNCTIONS =============================//
//=========================================================================//
//=========================================================================//

function _solarRot(day_ang, day, hour_ang, hour, latitude, north) {
    const vec = new THREE.Vector3(0, 0, -1);
    vec.applyAxisAngle(XAXIS, day_ang * day);
    vec.applyAxisAngle(YAXIS, hour_ang * hour);
    vec.applyAxisAngle(XAXIS, latitude);
    vec.applyAxisAngle(ZAXIS, -north);
    return [vec.x, vec.y, vec.z];
}


function _solarRaysDirect(latitude, detail) {
    let dir_vecs = [];
    // set the level of detail
    // const day_step = [182 / 4, 182 / 5, 182 / 6, 182 / 7, 182 / 8, 182 / 9, 182 / 10][detail];
    // const day_step = [182 / 3, 182 / 6, 182 / 9, 182 / 12][detail];
    const day_step = [182 / 3, 182 / 6, 182 / 12, 182 / 12][detail];
    const num_day_steps = Math.round(182 / day_step) + 1;
    // const hour_step = [0.25 * 6, 0.25 * 5, 0.25 * 4, 0.25 * 3, 0.25 * 2, 0.25 * 1, 0.25 * 0.5][detail];
    // const hour_step = [0.25 * 6, 0.25 * 4, 0.25 * 1, 0.25 * 0.5][detail];
    const hour_step = [0.25 * 6, 0.25 * 4, 0.25 * 1, 0.25 * 0.5][detail];
    // get the angles in radians
    const day_ang_rad = degToRad(47) / 182;
    const hour_ang_rad = (2 * Math.PI) / 24;
    // get the atitude angle in radians
    const latitude_rad = degToRad(latitude);
    // get the angle from y-axis to north vector in radians
    const north_rad = 0;
    // create the vectors
    for (let day_count = 0; day_count < num_day_steps; day_count++) {
        const day = -91 + day_count * day_step;
        const one_day_path = [];
        // get sunrise
        let sunrise = 0;
        let sunset = 0;
        for (let hour = 0; hour < 24; hour = hour + 0.1) {
            const sunrise_vec = _solarRot(day_ang_rad, day, hour_ang_rad, hour, latitude_rad, north_rad);
            if (sunrise_vec[2] > -1e-6) {
                sunrise = hour;
                sunset = 24 - hour;
                one_day_path.push(sunrise_vec);
                break;
            }
        }
        // morning sun path, count down from midday
        for (let hour = 12; hour > sunrise; hour = hour - hour_step) {
            const am_vec = _solarRot(day_ang_rad, day, hour_ang_rad, hour, latitude_rad, north_rad);
            if (am_vec[2] > -1e-6) {
                one_day_path.splice(1, 0, am_vec);
            }
            else {
                break;
            }
        }
        // afternoon sunpath, count up from midday
        for (let hour = 12 + hour_step; hour < sunset; hour = hour + hour_step) {
            const pm_vec = _solarRot(day_ang_rad, day, hour_ang_rad, hour, latitude_rad, north_rad);
            if (pm_vec[2] > -1e-6) {
                one_day_path.push(pm_vec);
            }
            else {
                break;
            }
        }
        // sunset
        const sunset_vec = _solarRot(day_ang_rad, day, hour_ang_rad, sunset, latitude_rad, north_rad);
        one_day_path.push(sunset_vec);
        // add it to the list
        dir_vecs = dir_vecs.concat(one_day_path);
    }
    // console.log("num rays = ", arrMakeFlat(directions).length);
    return dir_vecs;
}

function solarDirs(latitude, detail) {
    const solarDirs = _solarRaysDirect(latitude, detail)
    const vecs = solarDirs.reduce((arr, v) => {
        if (v[2] < 0) { return arr }
        if (v[0] === 0 && v[1] === 0) { 
            arr.push([v, null])
            return arr
        }
        let a = Math.atan2(v[0], v[1]) * 180 / Math.PI
        if (a < 0) { a += 360 }
        arr.push([v, a])
        return arr
    }, [])
    vecs.sort((a, b) => {
        return a[1] - b[1]
    })
    return vecs
}


//=========================================================================//
//=========================================================================//
//============================ UTIL FUNCTIONS =============================//
//=========================================================================//
//=========================================================================//

function degToRad(deg) {
    if (Array.isArray(deg)) {
        return deg.map((a_deg) => degToRad(a_deg));
    }
    return deg * (Math.PI / 180);
}

function iDir(sensor, endPt) {
    const dirX = endPt[0] - sensor[0]
    const dirY = endPt[1] - sensor[1]
    const l = Math.sqrt(dirX * dirX + dirY * dirY)
    let a = Math.atan2(dirX, dirY) * 180 / Math.PI
    if (a < 0) { a += 360 }
    return [[dirX / l, dirY / l], a]
}

function rayLineIntersect(s, v, p1, p2) {
    const denom = (p2[1] - p1[1]) * v[0] - (p2[0] - p1[0]) * v[1];
    return ((p2[0] - p1[0]) * (s[1] - p1[1]) - (p2[1] - p1[1]) * (s[0] - p1[0])) / denom
}

function pointInPgon(point, vs) {
    var x = point[0], y = point[1];

    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i][0], yi = vs[i][1];
        var xj = vs[j][0], yj = vs[j][1];

        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
};

function rayPgonIntersect(s, v, pgon, plane_normal) {

    const denominator = dotProduct(v, plane_normal)

    if (denominator == 0) { return [false, null] } // ray is parallel to the polygon

    const ray_scalar = dotProduct(vectorSub(pgon[0], s), plane_normal) / denominator

    if (ray_scalar < 0) { return [false, null] }

    const intsn = vectorAdd(s, scalarMult(ray_scalar, v))
    if (plane_normal[2] === 0) {
        if (plane_normal[1] === 0) {
            return [pointInPgon([intsn[1], intsn[2]], pgon.map(c => [c[1], c[2]])), intsn]
        }
        return [pointInPgon([intsn[0], intsn[2]], pgon.map(c => [c[0], c[2]])), intsn]
    }
    return [pointInPgon(intsn, pgon), intsn]
}


function dotProduct(A, B) {
    return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]
}

function crossProduct(A, B) {
    return [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]]
}

function vectorAdd(A, B) {
    return [A[0] + B[0], A[1] + B[1], A[2] + B[2]]
}
function vectorSub(A, B) {
    return [A[0] - B[0], A[1] - B[1], A[2] - B[2]]
}

function scalarMult(a, B) {
    return [a * B[0], a * B[1], a * B[2]]
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
  


module.exports = {
    // sky
    genSkyRays,
    skyRays,

    // solar
    solarDirs,

    // angle
    degToRad,

    // line 
    iDir,
    rayLineIntersect,
    pointInPgon,
    rayPgonIntersect,

    // vector
    dotProduct,
    crossProduct,
    vectorAdd,
    vectorSub,
    scalarMult,

    // projection conversion
    proj_obj_svy
}

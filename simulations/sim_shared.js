// const fs = require('fs');
// =================================================================================================
/**
 * Initialise the SIM model.
 * @param {*} sim 
 * @param {*} model_data 
 * @param {*} context_data 
 */
function initModel(sim, model_data, context_data = null) {
    // import model data
    sim.io.ImportData(model_data, 'sim');
    if (context_data !== null) {
        sim.io.ImportData(context_data, 'sim');
    }
}
// =================================================================================================
/**
 * Get a list of sensors and a list of obstructions by specifying teh sensor type ('facade' or 
 * 'ground').
 * The sensors are rays.
 * The obstructions are polygon IDs.
 * @param {*} sim 
 * @param {*} sens_type Either 'facade' or 'ground'
 * @returns A list of lists, [sens_rays, sens_obs, sens_pgons]
 */
function getSensObs(sim, sens_type) {
    const all_pgons = sim.query.Get('pg', null);
    // get sensor polygons
    const sens_pgons = sim.query.Filter(all_pgons, 'type', '==', sens_type);
    // get rays
    const sens_rays = sim.calc.Ray(sens_pgons);
    // get obstructions pgons
    const sens_obs = sim.query.Filter(all_pgons, 'obstruction', '==', true);
    // retuurn rays and obstruction pgons
    return [sens_rays, sens_obs, sens_pgons];
}
// =================================================================================================
/**
 * Get a list of sensors and a list of obstructions, given a set of sensor polygons.
 * The sensors are rays.
 * The obstructions are polygon IDs.
 * @param {*} sim 
 * @param {*} sens_pgons A list of polygon IDs used for generating sensors. 
 * @returns A list of lists, [sens_rays, sens_obs]
 */
 function getSensObsFromPgons(sim, sens_pgons) {
    const all_pgons = sim.query.Get('pg', null);
    // get rays
    const sens_rays = sim.calc.Ray(sens_pgons);
    // get obstructions pgons
    const sens_obs = sim.query.Filter(all_pgons, 'obstruction', '==', true);
    // retuurn rays and obstruction pgons
    return [sens_rays, sens_obs, sens_pgons];
}
// =================================================================================================
/**
 * Check that we have sensors and that we have bstructions.
 * @param {*} sens_rays A list of sensor rays.
 * @param {*} obs_pgons A list of polygon IDs of obstructions.
 * @param {*} sim_name The name of the simulation, for error messages.
 */
function checkErrorBeforSim(sim_name, sens_rays, obs_pgons) {
    // check for error befre sim
    if (sens_rays.length === 0 || obs_pgons.length === 0) {
        const msg = 'Error in ' + sim_name + ' evaluation: '+  
            'number of rays = ' + sens_rays.length +', '+ 
            'number of obstructions = ' + obs_pgons.length +'.';
        console.log(msg); throw new Error(msg);
    }
}
// =================================================================================================
/**
 * Check that we have results, and that the number of results matches the number of sensors.
 * @param {*} sens_rays A list of sensor rays.
 * @param {*} values A list of numbers.
 * @param {*} sim_name The name of the simulation, for error messages.
 */
function checkErrorAfterSim(sim_name, sens_rays, values) {
    if (!values) {
        const msg = 'Error in ' + sim_name + ': results = ' + values + '.';
        console.log(msg);
        throw new Error(msg);
    }
    if (sens_rays.length !== values.length) {
        const msg = 'Error in ' + sim_name + ': '+  
            'The number of results does not match the number of sensors.' +
            'Number of sensors: ' + sens_rays.length +', '+ 
            'Number of results: ' +  values.length +'.';
        console.log(msg);
        throw new Error(msg);
    }
}
// =================================================================================================
/**
 * Visualise the simulation results.
 * Adds colours to the polygons.
 * Creates a HUD (heads up display).
 * Also creates a north sign.
 * @param {*} sim 
 * @param {*} results A dictionary of simulation results data.
 * @param {*} attrib_name The name of the attribute to create in the model.
 * @param {*} col_range A list of 2 numbers, [min, max], the colour range.
 */
function visSimResults(sim, results, attrib_name, col_range) {
    const {sim_name, sens_type, values, des_range, des_area, score, unit} = results;
    const sens_pgons = getSensorPgons(sim, sim_name, sens_type, values);
    // create colors for polygons
    if (col_range === null) {
        col_range = [Math.min(...values), Math.max(...values)];
    }
    sim.attrib.Set(sens_pgons, attrib_name, values, 'many_values');
    sim.visualize.Gradient(sens_pgons, attrib_name, col_range, ['green','yellow','red']);
    // create crosses on undesirable pgons
    crossSensPgons(sim, values, sens_pgons, des_range);
    // create a message for the Heads Up Display
    let hud_msg = '<div style="line-height:1.1;">'
    hud_msg += '<h3>' + sim_name + '</h3><br>';
    if ('settings' in results) {
        hud_msg += results.settings + '<br>'
    }
    hud_msg += 'Desirable range: ' + 
            Math.round(des_range[0]) + ' to ' +  
            Math.round(des_range[1]) + ' ' + unit + ' <br>' +
        // 'Desirable area: ' + Math.round(des_area) + ' m2<br>' +
        '<b>Score: ' + Math.round(score * 10)/10 + ' %</b><br>';
    if ('other' in results) {
        hud_msg += results.other + '<br>'
    }
    hud_msg += '</div>'
    // create a legend for the Heads Up Display
    const leg_labels = [];
    const col_range_diff = col_range[1] - col_range[0];
    const num_labels = 11;
    for (let i = 0; i < num_labels; i ++) {
        const val = col_range[0] + (col_range_diff * (i / (num_labels - 1)));
        const val_sf = sim.inl.sigFig(val, 2);
        leg_labels.push(val_sf + ' ' + results.unit);
    }
    const hud_leg = sim.inl.htmlColLeg([300, 20], leg_labels);
    // Heads Up Display
    const hud = hud_msg + hud_leg;
    // set Heads Up Display
    sim.attrib.Set(null, "hud", hud);
}
// =================================================================================================
/**
 * North sign
 * @param {*} sim 
 * @param {*} sim_name The name of teh simulation, for error messages.
 * @param {*} sens_type 'facade' or 'ground'
 * @param {*} values A list of numbers
 * @returns 
 */
 function northSign(sim, xyz) {
    // create a north sign
    const north_plines = sim.visualize.Ray([xyz, [0, 100, 0]], 20);
    const north1 = sim.poly2d.OffsetMitre([north_plines[1],north_plines[2]], 10, 10, 'square_end');
    const north2 = sim.poly2d.OffsetMitre(north_plines[0], 10, 10, 'butt_end');
    sim.poly2d.Union([north1, north2]);
    sim.edit.Delete([north_plines, north1, north2], 'delete_selected');
}
// =================================================================================================
/**
 * Get the polygons that are being used to generate sensors.
 * The 'sens_type' can be either 'facade' or 'ground'.
 * The number of polygons should match the number of results.
 * @param {*} sim 
 * @param {*} sim_name The name of teh simulation, for error messages.
 * @param {*} sens_type 'facade' or 'ground'
 * @param {*} values A list of numbers
 * @returns 
 */
function getSensorPgons(sim, sim_name, sens_type, values) {
    // get the polygons being evaluated
    const sens_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', sens_type);
    // check we have right number of values
    if (sens_pgons.length !== values.length) {
        const msg = 'Error in ' + sim_name + ': '+  
            'The number of results does not match the number of entities.' +
            'Number of results: ' + values.length +', '+ 
            'Number of entities: ' +  sens_pgons.length +'.';
            console.log(msg);
            throw new Error(msg);
    }
    // return the pgons
    return sens_pgons;
}
// =================================================================================================
/**
 * Get the polygons that are being used to generate sensors.
 * The 'sens_type' can be either 'facade' or 'ground'.
 * The number of polygons should match the number of results.
 * @param {*} sim 
 * @param {*} sens_pgons A list of polygon IDs used for generating sensors.
 * @param {*} values A list of numbers
 * @returns 
 */
 function crossSensPgons(sim, values, sens_pgons, des_range) {
    const [des_min, des_max] = des_range;
    // calculate areas for good and bag pgons
    for (let i = 0; i < sens_pgons.length; i++) {
        const val = values[i];
        if (val < des_min || val > des_max) {
            const pln = sim.calc.Plane(sens_pgons[i]);
            const a = sim.inl.vecGtoL([-1, -1, 0.1], pln);
            const b = sim.inl.vecGtoL([ 1,  1, 0.1], pln);
            const c = sim.inl.vecGtoL([-1,  1, 0.1], pln);
            const d = sim.inl.vecGtoL([ 1, -1, 0.1], pln);
            sim.make.Polyline(sim.make.Position([a, b]), false);
            sim.make.Polyline(sim.make.Position([c, d]), false);
        }
    }
}
// =================================================================================================
/**
 * Calculates the score for a set of results.
 * For each result, it checks if it is in the desird range and calculates the area of the polygon.
 * The total of the good and bad reas are calculated. 
 * This is called in both fn-single and fn-combined.
 * @param {*} sim 
 * @param {*} values A list of numbers.
 * @param {*} sens_pgons A list of polygon IDs used for generating sensors. 
 * @param {*} des_range A list of 2 numbers [min, max], the desired range for this analysis.
 * @returns The score, a % between 0 and 100.
 */
function calcScore(sim, values, sens_pgons, des_range) {
    const [des_min, des_max] = des_range;
    // calculate areas for good and bag pgons
    let des_area = 0;
    let undes_area = 0;
    for (let i = 0; i < sens_pgons.length; i++) {
        const val = values[i];
        const area = sim.calc.Area(sens_pgons[i]);
        if (val < des_min || val > des_max) {
            undes_area += area;
        } else {
            des_area += area;
        }
    }
    const score = 100 * des_area / (des_area + undes_area);
    return [des_area, score];
}
// =================================================================================================
/**
 * Calculates the UHI for the whole site, based on a set of results for Sky Exposure on the ground
 * plane.
 * The Sky Exposure values should be unweighted, in the range of 0 to 1.
 * For each result, it calculates delta T and calculates the area of the polygon.
 * @param {*} sim 
 * @param {*} values A list of numbers, the Sky Exposure scores (0 to 1).
 * @param {*} sens_pgons A list of polygon IDs used for generating sensors. 
 * @returns The UHI score, a delta in degrees.
 */
 function calcUHI(sim, values, sens_pgons) {
    let total_area = 0;
    let total_uhi = 0;
    for (let i = 0; i < sens_pgons.length; i++) {
        const uhi = values[i];
        const area = sim.calc.Area(sens_pgons[i]);
        total_area += area;
        total_uhi += (uhi * area);
    }
    const mean_uhi_score = total_uhi / total_area;
    return mean_uhi_score;
}
// =================================================================================================
/**
 * Gets the roads from the model, for the 'noise' evaluation.
 * The roads are polylines with attribs like 'road_65'. 
 * This is a road that has 65dB. 
 * @param {*} sim 
 * @returns Two lists, the polyline IDs of the roads, and a list of noise levels (in dB).
 */
function getRoads(sim) {
    const plines = sim.query.Get('pl', null);
    const roads = [];
    const noise_lvls = []
    for (const pline of plines) {
        const att_type = sim.attrib.Get(pline, 'type');
        if (att_type && att_type.startsWith('road')) {
            roads.push(pline);
            const att_parts = att_type.split('_');
            const noise_lvl = parseFloat(att_parts[att_parts.length - 1]);
            noise_lvls.push( noise_lvl );
        }
    }
    return [roads, noise_lvls];
}
// =================================================================================================
/**
 * Gets scenic positions from the model, for the 'visibility' evaluation.
 * Polylines and polygons with the attrib 'scenic' are first retrieved.
 * The edges are then divided by 10 meters, to generate a series of positions.
 * These positions are then returned.
 * @param {*} sim 
 * @returns A list of unique position IDs.
 */
function getVisPosis(sim) {
    const posis_set = new Set();
    // and pgon posis
    for (const pgon of sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'scenic')) {
        sim.edit.Divide(pgon, 10, 'by_max_length');
        for (const posi of sim.query.Get('ps', pgon)) {
            posis_set.add(posi);
        }
    }
    // and pline posis
    for (const pline of sim.query.Filter(sim.query.Get('pl', null), 'type', '==', 'scenic')) {
        sim.edit.Divide(pline, 10, 'by_max_length');
        for (const posi of sim.query.Get('ps', pline)) {
            posis_set.add(posi);
        }
    }
    // return the posis
    return Array.from(posis_set);
}
// =================================================================================================
/**
 * Write a file.
 * @param {*} path 
 * @param {*} data 
 */
function writeFile(path, data) {  // }, {encoding: 'utf8'}) {
    // try {
    //     fs.writeFileSync(path, data);
    // } catch(err) {
    //     console.log("Error writing file.");
    //     console.error(err);
    //     throw new Error("Error reading file: " + err.message);
    // }
    //console.log("Writing " + msg + " file successful.");
}
// =================================================================================================
module.exports = { 
    initModel: initModel,
    getSensObs: getSensObs,
    getSensObsFromPgons: getSensObsFromPgons,
    checkErrorBeforSim: checkErrorBeforSim,
    checkErrorAfterSim: checkErrorAfterSim,
    visSimResults:visSimResults,
    getSensorPgons: getSensorPgons,
    calcScore: calcScore,
    calcUHI: calcUHI,
    getRoads: getRoads,
    getVisPosis: getVisPosis,
    writeFile: writeFile
}
// =================================================================================================
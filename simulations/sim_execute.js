const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');

const shared = require("./sim_shared.js");
const generate = require("./sim_generate.js").execute;
const sg_wind = require('./sg_wind_all.js').sg_wind;
const proj4 = require('proj4');
const shapefile = require("shapefile");

const solar_settings = {
    DETAIL: 1,
    RADIUS: 1000,
    FACADE_MAX_VAL: 0.6945730087671974,
}
const sky_settings = { 
    DETAIL: 0,
    RADIUS: 1000,
    FACADE_MAX_VAL: 0.5989617186548527
}
const uhi_settings = { 
    DETAIL: 0,
    RADIUS: 1000
}
const wind_settings = { 
    NUM_RAYS: 4,
    RADIUS: 200,
    LAYERS: [1, 18, 4]
}


const config = {
    "latitude":1.298759,
    "longitude":103.778329,
    "g_solar_min":0,
    "g_solar_max":50,
    "g_sky_min":50,
    "g_sky_max":100,
    "g_uhi_min":0,
    "g_uhi_max":4,
    "g_wind_min":60,
    "g_wind_max":100,
    "g_irr_min":0,
    "g_irr_max":800,
    "g_irr_rad_min":0,
    "g_irr_rad_max":800,
    "f_solar_min":0,
    "f_solar_max":50,
    "f_sky_min":50,
    "f_sky_max":100,
    "f_irr_min":0,
    "f_irr_max":500,
    "f_irr_rad_min":0,
    "f_irr_rad_max":500,
    "f_noise_min":0,
    "f_noise_max":60,
    "f_unob_min":80,
    "f_unob_max":100,
    "f_visib_min":0,
    "f_visib_max":60,
}

const LONGLAT = [103.778329, 1.298759];
const TILE_SIZE = 500;


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

function fillString(x) {
    if (x < 0) {
        const s = x.toString()
        return '-' + ('00000' + s.slice(1)).slice(s.length - 1)
    }
    const s = x.toString()
    return ('00000' + s).slice(s.length)
}

function eval_solar(sim, gen_file, sens_type = 'ground') {
    const settings = solar_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, sens_type);
    // run simulation after sim
    const sim_name = 'Solar Exposure (' + sens_type + ')';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);

    // let data = {exposure: []}
    // fs.writeFileSync(gen_file + '_progress', '0 ' + sens_rays.length)
    // for (let i = 0; i < sens_rays.length; i ++) {
    //     const result = sim.analyze.Sun([sens_rays[i]], obs_pgons, settings.RADIUS, settings.DETAIL,'direct_weighted');
    //     data.exposure.push(result.exposure[0])
    //     fs.writeFileSync(gen_file + '_progress', (i + 1) + ' ' + sens_rays.length)
    // }
    
    const data = sim.analyze.Sun(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL,'direct_weighted');
    const max_val = sens_type === 'facade' ? settings.FACADE_MAX_VAL : 1;
    const values = data['exposure'].map(v => Math.min(Math.max(v / max_val, 0), 1) * 100);
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config[sens_type[0] +'_solar_min'], config[sens_type[0] +'_solar_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // return results
    return {
        sim_name: sim_name,
        sens_type: sens_type, 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m'
    };
}
function eval_sky(sim, gen_file, sens_type = 'ground') {
    const settings = sky_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, sens_type);
    // run simulation
    const sim_name = 'Sky Exposure (' + sens_type + ')';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
    const data = sim.analyze.Sky(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL, 'weighted');
    const max_val = sens_type === 'facade' ? settings.FACADE_MAX_VAL : 1;
    const values = data['exposure'].map(v => Math.min(Math.max(v / max_val, 0), 1) * 100);
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config[sens_type[0] +'_sky_min'], config[sens_type[0] +'_sky_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    const UHII = Math.round((-6.51 * (values.reduce((partialSum, a) => partialSum + a, 0)) / (values.length * 100) + 7.13) * 1000) / 1000
    const extra_info = `<div>Spatially-arranged air temperature increment (UHI): ${UHII} (deg C)</div>`
    sim.attrib.Set(null, "extra_info", extra_info);
    // return results
    return {
        sim_name: sim_name,
        sens_type: sens_type, 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m',
    };
}

function eval_uhi(sim, gen_file, sens_type = 'ground') {
    const settings = uhi_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, sens_type);
    // run simulation
    const sim_name = 'Urban Heat Island (' + sens_type + ')';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
    const data = sim.analyze.Sky(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL, 'unweighted');
    const values = data['exposure'].map(v => (-6.51 * v) + 7.13); // UHI formula for Singapore developed by Dr Yuan Chao
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config[sens_type[0] +'_uhi_min'], config[sens_type[0] +'_uhi_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // calc UHI
    const mean_uhi = shared.calcUHI(sim, values, sens_pgons);
    // return results
    return {
        sim_name: sim_name,
        sens_type: sens_type, 
        values: values, 
        unit: 'deg',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m',
        other: 'Mean UHI: ' + sim.inl.sigFig(mean_uhi, 2) + '°'
    };
}
function eval_wind(sim, gen_file, weather_stn='S24') {
    const sens_type = 'ground';
    const settings = wind_settings
    // import model data
    // add data to model
    const sg_wind_data = sg_wind[weather_stn];
    sim.attrib.Set(null, 'wind', sg_wind_data, 'one_value');    
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, sens_type);
    const obs_pgons_no_wlkwy = sim.query.Filter(obs_pgons, 'type', '!=', 'walkway');
    // run simulation after sim
    const sim_name = 'Wind Permeability (' + sens_type + ')';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons_no_wlkwy);
    const results = sim.analyze.Wind(sens_rays, obs_pgons_no_wlkwy, settings.RADIUS, settings.NUM_RAYS, settings.LAYERS);
    const values = results['wind'].map(v => Math.min(Math.max(v, 0), 1) * 100);
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config[sens_type[0] +'_wind_min'], config[sens_type[0] +'_wind_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // return results
    return {
        sim_name: sim_name,
        sens_type: sens_type, 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m'
    };  
}


async function readSource(bounds) {
    const source = await shapefile.open("assets/_shp_/singapore_buildings.shp")
    const jsonData = {
        "type": "FeatureCollection",
        "name": "sg_dwelling_simplified3",
        "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        "features": []
    }
    while (true) {
        const result = await source.read()
        if (!result || result.done) { break; }
        // if (!result.value.properties.AGL || result.value.properties.AGL < 1) {
        //     console.log(result.value)
        //     continue
        // }
        let c = result.value.geometry.coordinates[0][0]
        while (c.length > 2) {
            c = c[0]
        }
        const xy = proj_obj.forward(c);
        if (xy[0] < bounds[0][0] || xy[1] < bounds[0][1] || xy[0] > bounds[1][0] || xy[1] > bounds[1][1]) {
            continue
        }
        jsonData.features.push(result.value)
    }
    const jsonDataString = JSON.stringify(jsonData)

    const mfn = new SIMFuncs();
    await mfn.io.Import(jsonDataString, 'geojson');
    const allPgons = mfn.query.Get('pg', null)
    for (const pgon of allPgons){
        const dist = mfn.attrib.Get(pgon, 'AGL')
        if (!dist) {
            continue
        }
        mfn.make.Extrude( pgon, dist, 1, 'quads' );
    }
    return mfn
}
// Loop through all the files in the temp directory

async function simExecute(type, genFile, index, PROCESS_LIMIT, closest_stn_id) {
    
    const sim = new SIMFuncs();
    sim.getModel().debug = false;
    const gen = fs.readFileSync(genFile, {encoding:'utf8', flag:'r'});
    shared.initModel(sim, gen);
    
    const all_ground_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'ground');
    let division = all_ground_pgons.length / PROCESS_LIMIT
    if (division < 5) {
        division = 5
    } else {
        division = Math.ceil(division)
    }
    
    startIndex = index * division
    endIndex = (index + 1) * division
    for (let i = startIndex; i < endIndex; i++) {
        if (startIndex >= all_ground_pgons.length) { break; }
        all_ground_pgons.splice(startIndex, 1)
    }
    sim.edit.Delete(all_ground_pgons, 'delete_selected')
    const remaining_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'ground')

    if (remaining_pgons.length === 0) {
        // fs.writeFileSync(genFile + '_' + index + '.txt', ' ')
        return
    }

    console.log('starting simulation for', genFile, 'at index', index)
    let result
    if (type === 'solar') {
        // const col_range = [0, 100];
        result = eval_solar(sim, genFile + '_' + index)
        // shared.visSimResults(sim, result, 'solar_exposure', col_range);    

    } else if (type === 'sky') {
        // const col_range = [100, 0];
        result = eval_sky(sim, genFile + '_' + index)
        // shared.visSimResults(sim, result, 'sky_exposure', col_range);

    } else if (type === 'uhi') {
        // const col_range = [2, 6];
        result = eval_uhi(sim, genFile + '_' + index)
        // shared.visSimResults(sim, result, 'uhi', col_range);

    } else if (type === 'wind') {
        // const col_range = [100, 0];
        result = eval_wind(sim, genFile + '_' + index, closest_stn_id)

        // shared.visSimResults(sim, result, 'wind_per', col_range);

    } else {
        return null
    }
    console.log('simulation finished, writing result')
    fs.writeFileSync(genFile + '_' + index + '.txt', result.values.join(','))
    // const ground_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'ground');
    // sim.modify.Move(ground_pgons, [-coords[0][0], -coords[0][1], 0])
    // sim.edit.Delete(ground_pgons, 'keep_selected')
    // return sim
}

const type = process.argv[2]
const genfile = process.argv[3]
const index = Number(process.argv[4])
const lim = Number(process.argv[5])
const closest_stn_id = process.argv[6]
if (type && genfile) {
    simExecute(type, genfile, index, lim, closest_stn_id)
}

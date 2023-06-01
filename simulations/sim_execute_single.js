const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');

const shared = require("./sim_shared.js");
const generate = require("./sim_generate.js").execute;
const sg_wind = require('./sg_wind_all.json')
const sg_wind_stn_data = require('./sg_wind_station_data.json')

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

const input_dir = 'src/assets/simdata/'
const output_dir = 'src/assets/result'

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

function eval_solar(sim, model_data, sens_type = 'ground') {
    const settings = solar_settings
    // import model data
    shared.initModel(sim, model_data);
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, sens_type);
    // run simulation after sim
    const sim_name = 'Solar Exposure (' + sens_type + ')';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
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
function eval_sky(sim, model_data, sens_type = 'ground') {
    const settings = sky_settings
    // import model data
    shared.initModel(sim, model_data);
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

function eval_uhi(sim, model_data, sens_type = 'ground') {
    const settings = uhi_settings
    // import model data
    shared.initModel(sim, model_data);
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
function eval_wind(sim, model_data, weather_stn='S24') {
    const sens_type = 'ground';
    const settings = wind_settings
    // import model data
    shared.initModel(sim, model_data);
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

// Loop through all the files in the temp directory

async function run(type, filename) {
    console.log('simulating', type, 'for file:',filename)
    const input_file = input_dir + filename;
    const fileData = fs.readFileSync(input_file, {encoding:'utf8', flag:'r'});
    const gen = await generate(fileData, config)
    fs.writeFileSync('./test.sim', gen)
    const sim = new SIMFuncs();

    let outDir
    if (type === 'solar') {
        const col_range = [0, 100];
        outDir = '_solar/'
        const result = eval_solar(sim, gen)
        fs.writeFileSync(output_dir + '_raw' + outDir + filename + '.json', JSON.stringify(result))
        return
        shared.visSimResults(sim, result, 'solar_exposure', col_range);    

    } else if (type === 'sky') {
        const col_range = [100, 0];
        outDir = '_sky/'
        const result = eval_sky(sim, gen)
        shared.visSimResults(sim, result, 'sky_exposure', col_range);

    } else if (type === 'uhi') {
        const col_range = [2, 6];
        outDir = '_uhi/'
        const result = eval_uhi(sim, gen)
        shared.visSimResults(sim, result, 'uhi', col_range);

    } else if (type === 'wind') {
        const col_range = [100, 0];
        outDir = '_wind/'
    
        let closest_stn = {id: 'S24', dist2: null}

        const filecoord = filename.split('.sim')[0].split('data_')[1].split('_').map(x => Number(x))
    
        for (const stn of sg_wind_stn_data) {
            const distx = stn.coord[0] - filecoord[0]
            const disty = stn.coord[1] - filecoord[1]
            const dist2 = distx * distx + disty * disty
            if (!closest_stn.dist2 || closest_stn.dist2 > dist2) {
                closest_stn.id = stn.id
                closest_stn.dist2 = dist2
            }
        }
        const result = eval_wind(sim, gen, closest_stn.id)

        shared.visSimResults(sim, result, 'wind_per', col_range);

    } else {
        return
    }

    // // const col_range = [100, 0];

    // const glass_mat = sim.material.Glass('glass', 0.5)
    const ground_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'ground');
    // sim.material.Set(ground_pgons, 'glass')

    const solar_model = await sim.io.ExportData(ground_pgons, 'sim');

    // sim.edit.Delete(sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'site'), 'delete_selected');
    // const solar_model = await sim.io.ExportData(null, 'sim');
    if (!fs.existsSync(output_dir)){
        fs.mkdirSync(output_dir);
    }

    fs.writeFileSync(output_dir + outDir + filename, solar_model)
}
run(process.argv[2], process.argv[3])

// =================================================================================================

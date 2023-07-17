const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const fs = require('fs');

const shared = require("./sim_shared.js");
const sg_wind = require('./sg_wind_all.js').sg_wind;
const sg_stn_data = require('./sg_wind_station_data.js').sg_wind_stn_data;
const proj4 = require('proj4');
const shapefile = require("shapefile");
const { config } = require("./const.js");

const solar_settings = {
    DETAIL: 1,
    RADIUS: 300,
    FACADE_MAX_VAL: 0.6945730087671974,
}
const sky_settings = { 
    DETAIL: 0,
    RADIUS: 300,
    FACADE_MAX_VAL: 0.5989617186548527
}
const uhi_settings = { 
    DETAIL: 0,
    RADIUS: 300
}
const wind_settings = { 
    NUM_RAYS: 2,
    RADIUS: 200,
    LAYERS: [1, 18, 4]
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

function eval_solar(sim) {
    const settings = solar_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, 'ground');
    // run simulation after sim
    const sim_name = 'Solar Exposure (ground)';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
    
    const data = sim.analyze.Sun(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL,'direct_weighted');
    const max_val = 1;
    const values = data['exposure'].map(v => Math.min(Math.max(v / max_val, 0), 1) * 100);
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config['g_solar_min'], config['g_solar_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // return results
    return {
        sim_name: sim_name,
        sens_type: 'ground', 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m'
    };
}
function eval_sky(sim) {
    const settings = sky_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, 'ground');
    // run simulation
    const sim_name = 'Sky Exposure (ground)';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
    const data = sim.analyze.Sky(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL, 'weighted');
    const max_val = 1;
    const values = data['exposure'].map(v => Math.min(Math.max(v / max_val, 0), 1) * 100);
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config['g_sky_min'], config['g_sky_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    const UHII = Math.round((-6.51 * (values.reduce((partialSum, a) => partialSum + a, 0)) / (values.length * 100) + 7.13) * 1000) / 1000
    const extra_info = `<div>Spatially-arranged air temperature increment (UHI): ${UHII} (deg C)</div>`
    sim.attrib.Set(null, "extra_info", extra_info);
    // return results
    return {
        sim_name: sim_name,
        sens_type: 'ground', 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m',
    };
}

function eval_uhi(sim) {
    const settings = uhi_settings
    // import model data
    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, 'ground');
    // run simulation
    const sim_name = 'Urban Heat Island (ground)';
    shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons);
    const data = sim.analyze.Sky(sens_rays, obs_pgons, settings.RADIUS, settings.DETAIL, 'unweighted');
    const values = data['exposure'].map(v => (-6.51 * v) + 7.13); // UHI formula for Singapore developed by Dr Yuan Chao
    shared.checkErrorAfterSim(sim_name, sens_rays, values);
    // calc the score
    const des_range = [config['g_uhi_min'], config['g_uhi_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // calc UHI
    const mean_uhi = shared.calcUHI(sim, values, sens_pgons);
    // return results
    return {
        sim_name: sim_name,
        sens_type: 'ground', 
        values: values, 
        unit: 'deg',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m',
        other: 'Mean UHI: ' + sim.inl.sigFig(mean_uhi, 2) + '°'
    };
}
function eval_wind(sim) {
    const settings = wind_settings

    // get sensors and obstructions
    const [sens_rays, obs_pgons, sens_pgons] = shared.getSensObs(sim, 'ground');
    const obs_pgons_no_wlkwy = sim.query.Filter(obs_pgons, 'type', '!=', 'walkway');

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

    // run simulation for each of the weather station group
    const sim_name = 'Wind Permeability (ground)';
    for (const closest_stn_id in closest_stns) {
        const sg_wind_data = sg_wind[closest_stn_id];
        sim.attrib.Set(null, 'wind', sg_wind_data, 'one_value');    

        const closest_stn = closest_stns[closest_stn_id]
        const sens_rays = closest_stn.sens_rays
        const sens_pgons = closest_stn.sens_pgons
    
        shared.checkErrorBeforSim(sim_name, sens_rays, obs_pgons_no_wlkwy);
        const results = sim.analyze.Wind(sens_rays, obs_pgons_no_wlkwy, settings.RADIUS, settings.NUM_RAYS, settings.LAYERS);
        const values = results['wind'].map(v => Math.min(Math.max(v, 0), 1) * 100);
        shared.checkErrorAfterSim(sim_name, sens_rays, values);
        closest_stn.result = values;
    }
    const values = result_indexing.map(x => closest_stns[x[0]].result[x[1]])
    // calc the score
    const des_range = [config['g_wind_min'], config['g_wind_max']];
    const [des_area, score] = shared.calcScore(sim, values, sens_pgons, des_range);
    // return results
    return {
        sim_name: sim_name,
        sens_type: 'ground', 
        values: values, 
        unit: '%',
        des_range: des_range,
        des_area: des_area, 
        score: score,
        settings: 'Max distance: ' + settings.RADIUS + ' m',
        wind_stations: Object.keys(closest_stns).join(',')
    };  
}


async function readSource(bounds) {
    const source = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")
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

function addSite(sim, siteCoords, gridSize) {
    const sitePgonCoords = []
    for (const coord of siteCoords) {
        sitePgonCoords.push([
            [coord[0], coord[1], 0],
            [coord[0] + gridSize, coord[1], 0],
            [coord[0] + gridSize, coord[1] + gridSize, 0],
            [coord[0], coord[1] + gridSize, 0]
        ])
    }
    const pos = sim.make.Position(sitePgonCoords)
    const ground_pgons = sim.make.Polygon(pos)
    sim.attrib.Set(ground_pgons, 'type', 'ground', 'one_value');
    return ground_pgons
}

async function simExecute(type, obsFile, genFile, gridSize) {
    console.log('starting simulation for', genFile)
    const sim = new SIMFuncs();
    sim.getModel().debug = false;
    const obstructions = fs.readFileSync(obsFile, {encoding:'utf8', flag:'r'});
    shared.initModel(sim, obstructions);
    const siteCoordsText = fs.readFileSync(genFile, {encoding:'utf8', flag:'r'});
    const siteCoords = JSON.parse(siteCoordsText)
    addSite(sim, siteCoords, gridSize)
    let result
    if (type === 'solar') {
        // const col_range = [0, 100];
        result = eval_solar(sim)
        // shared.visSimResults(sim, result, 'solar_exposure', col_range);    

    } else if (type === 'sky') {
        // const col_range = [100, 0];
        result = eval_sky(sim)
        // shared.visSimResults(sim, result, 'sky_exposure', col_range);

    } else if (type === 'uhi') {
        // const col_range = [2, 6];
        result = eval_uhi(sim)
        // shared.visSimResults(sim, result, 'uhi', col_range);

    } else if (type === 'wind') {
        // const col_range = [100, 0];
        result = eval_wind(sim)

        // shared.visSimResults(sim, result, 'wind_per', col_range);

    } else {
        return null
    }
    console.log('simulation finished, writing result')
    fs.writeFileSync(genFile + '.txt', result.values.join(','))
    if (result.wind_stations) {
        fs.writeFileSync(genFile + '_wind_stns.txt', result.wind_stations)
    }
    const pgons = sim.query.Get('pg', null);
    sim.edit.Delete(pgons, 'delete_selected');
    delete sim
    delete gen
    // const ground_pgons = sim.query.Filter(sim.query.Get('pg', null), 'type', '==', 'ground');
    // sim.modify.Move(ground_pgons, [-coords[0][0], -coords[0][1], 0])
    // sim.edit.Delete(ground_pgons, 'keep_selected')
    // return sim
}

module.exports = (content) => {
    const argv = content.split(' ')
    const type = argv[0]
    const obsfile = argv[1]
    const genfile = argv[2]
    const gridSize = Number.parseInt(argv[3])
    if (type && genfile) {
        try {
            simExecute(type, obsfile, genfile, gridSize)
        } catch (ex) {
            console.log('.......', ex)
        }
    }
}

// const type = process.argv[2]
// const genfile = process.argv[3]
// const index = Number(process.argv[4])
// const lim = Number(process.argv[5])
// const closest_stn_id = process.argv[6]
// if (type && genfile) {
//     simExecute(type, genfile, index, lim, closest_stn_id)
// }

const shapefile = require("shapefile");
const fs = require('fs');
const SIMFuncs = require("@design-automation/mobius-sim-funcs").SIMFuncs;
const proj4 = require('proj4');
const { processObstructions } = require("./sim_generate");

const TILE_SIZE = 500
const LONGLAT = [103.778329, 1.298759];

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
async function writeModel(geom, coord) {
    const jsonData = {
        "type": "FeatureCollection",
        "name": "sg_dwelling_simplified3",
        "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        "features": geom[coord]
    }
    jsonDataString = JSON.stringify(jsonData)

    const mfn = new SIMFuncs();
    await mfn.io.Import(jsonDataString, 'geojson');
    const allPgons = mfn.query.Get('pg', null)
    if (allPgons.length === 0) { return; }
    for (const pgon of allPgons){
        const dist = mfn.attrib.Get(pgon, 'AGL')
        if (!dist) {
            continue
        }
        mfn.make.Extrude( pgon, dist, 1, 'quads' );
    }
    mfn.edit.Delete(allPgons, 'delete_selected')

    const exportedString = (await mfn.io.ExportData(null, 'sim'));

    const tbd = mfn.query.Get('pg', null);
    mfn.edit.Delete(tbd, 'delete_selected');

    const coords = coord.split('__').map(x => Number(x))
    const coordStr = coords.map(fillString).join('_')
    console.log('writing', coordStr)
    fs.writeFileSync(process.cwd() + '/assets/models/data_' + coordStr + '.sim', exportedString);
}
function fillString(x) {
    if (x < 0) {
        const s = x.toString()
        return '-' + ('00000' + s.slice(1)).slice(s.length - 1)
    }
    const s = x.toString()
    return ('00000' + s).slice(s.length)
}
async function processData(geom, coord) {
    const jsonData = {
        "type": "FeatureCollection",
        "name": "sg_dwelling_simplified3",
        "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        "features": []
    }
    const coords = coord.split('__').map(x => Number(x))
    console.log(coords)
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const addCoord = (coords[0] + (i * TILE_SIZE)) + '__' + (coords[1] + (j * TILE_SIZE))
            if (!geom[addCoord]) { continue; }
            jsonData.features = jsonData.features.concat(geom[addCoord])
        }
    }
    jsonDataString = JSON.stringify(jsonData)

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
    mfn.edit.Delete(allPgons, 'delete_selected')
    const allObstructions = mfn.query.Get('pg', null)
    mfn.attrib.Set(allObstructions, 'cluster', 1)
    mfn.attrib.Set(allObstructions, 'type', 'obstruction')
    mfn.attrib.Set(allObstructions, 'obstruction', true)
    const pos = mfn.pattern.Rectangle([coords[0] + TILE_SIZE / 2, coords[1] + TILE_SIZE / 2, 0], TILE_SIZE)
    const pgon = mfn.make.Polygon(pos)
    mfn.attrib.Set(pgon, 'type', 'site')
    mfn.attrib.Set(pgon, 'cluster', 0)
    const exportedString = (await mfn.io.ExportData(null, 'sim'));

    const tbd = mfn.query.Get('pg', null);
    mfn.edit.Delete(tbd, 'delete_selected');
    const coordStr = coords.map(fillString).join('_')
    fs.writeFileSync(process.cwd() + '/assets/simdata/data_' + coordStr + '.sim', exportedString);

}

async function readSource(source) {
    const geom = {}
    const proj_obj = _createProjection()
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
        const floor_xy = xy.map(x => Math.floor(x / TILE_SIZE)  * TILE_SIZE)
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const coord = (floor_xy[0] + i * TILE_SIZE) + '__' + (floor_xy[1] + j * TILE_SIZE) 
                if (!geom[coord]) { 
                    geom[coord] = []
                }
            }
        }
        geom[floor_xy.join('__')].push(result.value)
    }
    let i = 0;
    for (const coord in geom) {
        // if (i > 30) { break; }
        await writeModel(geom, coord)
        // await processData(geom, coord)
        i++
    }
}

// shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")
//   .then(readSource)
//   .catch(error => console.error(error.stack));

const shapefile = require("shapefile");
const proj4 = require('proj4');
const fs = require('fs');


function _createProjection() {
    const proj_from_str = 'WGS84';
    const proj_to_str = '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' +
        '+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
        '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs';
    const proj_obj = proj4(proj_from_str, proj_to_str);
    return proj_obj;
}
const proj_obj = _createProjection()


const RANGE = 500
const ROUNDING = 10 ** 3


function convert_CRS(inData, offset) {
    if (typeof inData[0] == 'number') {
        const result = proj_obj.forward(inData)
        result[0] = Math.round((result[0] - offset[0]) * ROUNDING) / ROUNDING
        result[1] = Math.round((result[1] - offset[1]) * ROUNDING) / ROUNDING
        return result
    } else {
        return inData.map(data => convert_CRS(data, offset))
    }
}

async function run() {
    const fileData = {}
    const shpFile = await shapefile.open(process.cwd() + "/assets/_shp_/singapore_buildings.shp")
    while (true) {
        const result = await shpFile.read()
        if (!result || result.done) { break; }
        // if (!result.value.properties.AGL || result.value.properties.AGL < 1) {
        //     console.log(result.value)
        //     continue
        // }
        let coords = result.value.geometry.coordinates[0]
        while (coords[0].length > 2) {
            coords = coords[0]
        }
        const minCoord = [9999, 9999]
        for (const c of coords) {
            minCoord[0] = Math.min(c[0], minCoord[0])
            minCoord[1] = Math.min(c[1], minCoord[1])
        }
        const convertedCoord = proj_obj.forward(minCoord)
        const fileIDCoord = [convertedCoord[0] - convertedCoord[0] % RANGE, convertedCoord[1] - convertedCoord[1] % RANGE]
        const fileID = `${fileIDCoord[0]}_${fileIDCoord[1]}`
        if (!fileData[fileID]) {
            fileData[fileID] = []
        }
        fileData[fileID].push([convert_CRS(result.value.geometry.coordinates[0], fileIDCoord), result.value.properties.AGL])
    }
    const indexing = Object.keys(fileData)
    for (const fileID of indexing) {
        if (fileData[fileID] && fileData[fileID].length > 0) {
            fs.writeFileSync('C:/Users/akibdpt/Documents/UCDL/ucdl-simulation/src/assets/buildings/f_' + fileID + '.json', JSON.stringify(fileData[fileID]))
        }
    }
    fs.writeFileSync('C:/Users/akibdpt/Documents/UCDL/ucdl-simulation/src/assets/buildings/index.json', JSON.stringify(indexing))
}
run()
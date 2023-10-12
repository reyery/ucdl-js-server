const { SIMFuncs } = require('@design-automation/mobius-sim-funcs');
const { default: Shape } = require('@doodle3d/clipper-js');
const proj4 = require('proj4');
const fs = require('fs');
const { sg_wind } = require('./sg_wind_all');

const SCALE = 10000000

const RESOLUTION = 1
const MAXHEIGHT = 27
const EPSILON = 0.00001

const GEOJSON_FORMAT = `{
    "type": "Feature",
    "properties": { "height": null },
    "geometry": { "coordinates": null, "type": "Polygon" },
    "id": 0
}`

const LONGLAT = [ 103.778329, 1.298759];
function _createProjection(fromcrs, tocrs) {
    const proj_obj = proj4(fromcrs, tocrs);
    return proj_obj;
}
const svy_proj4 = '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' +
'+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
'+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
const mob_proj4 = `+proj=tmerc +lat_0=${LONGLAT[1]} +lon_0=${LONGLAT[0]} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`
const proj_obj_mob_svy = _createProjection(mob_proj4, svy_proj4)


function round(number, prec) {
    const mult = Math.pow(10, prec)
    return Math.round(number * mult) / mult
}

function afdx1(DEM_array, m, n, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    let h = DEM_array[m][n]
    if (h >= MAXHEIGHT) { h = MAXHEIGHT }
    let afdx1 = 0
    if (WINDDIRECTION_angle > 0 && WINDDIRECTION_angle < 180) {
        afdx1 = Math.abs(Math.sin(WINDDIRECTION_theta)) * h
    }
    return afdx1
}

function afdx2(DEM_array, m, n, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    let h = DEM_array[m][n]
    if (h >= MAXHEIGHT) { h = MAXHEIGHT }
    let afdx2 = 0
    if (WINDDIRECTION_angle > 180 && WINDDIRECTION_angle < 360) {
        afdx2 = Math.abs(Math.sin(WINDDIRECTION_theta)) * h
    }
    return afdx2
}

function afdy1(DEM_array, m, n, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    let h = DEM_array[m][n]
    if (h >= MAXHEIGHT) { h = MAXHEIGHT }
    let afdy1 = 0
    if (WINDDIRECTION_angle > 90 && WINDDIRECTION_angle < 270) {
        afdy1 = Math.abs(Math.cos(WINDDIRECTION_theta)) * h
    }
    return afdy1
}

function afdy2(DEM_array, m, n, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    let h = DEM_array[m][n]
    if (h >= MAXHEIGHT) { h = MAXHEIGHT }
    let afdy2 = 0
    if (WINDDIRECTION_angle > 270 || WINDDIRECTION_angle < 90) {
        afdy2 = Math.abs(Math.cos(WINDDIRECTION_theta)) * h
    }
    return afdy2
}

function afd(DEM_array, m, n, Tile_DEM_height, Tile_DEM_width, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    let h = DEM_array[m][n]
    if (h >= MAXHEIGHT) { h = MAXHEIGHT }
    let afd = 0

    let dx = 0
    let dy = 0
    if (Math.sin(WINDDIRECTION_theta) > 0) { dx = 1 }
    else if (Math.sin(WINDDIRECTION_theta) < 0) { dx = -1 }

    if (Math.cos(WINDDIRECTION_theta) > 0) { dy = -1 }
    else if (Math.cos(WINDDIRECTION_theta) < 0) { dy = 1 }

    let x = m + dx
    let y = n + dy

    if ((x >= 0) && (x <= Tile_DEM_height - 1)) {
        let hdx = DEM_array[x][n]
        if (hdx >= MAXHEIGHT) { hdx = MAXHEIGHT }
        if ((round(h, 4) - round(hdx, 4)) > EPSILON) {
            afd = afd + Math.abs(Math.sin(WINDDIRECTION_theta)) * (h - hdx)
        }
    }
    if ((y >= 0) & (y <= Tile_DEM_width - 1)) {
        let hdy = DEM_array[m][y]
        if (hdy >= MAXHEIGHT) { hdy = MAXHEIGHT }
        if ((round(h, 4) - round(hdy, 4)) > EPSILON) {
            afd = afd + Math.abs(Math.cos(WINDDIRECTION_theta)) * (h - hdy)
        }
    }
    return round(afd, 4)
}

function tileFAD(DEM_array, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    const Tile_DEM_width = DEM_array[0].length
    const Tile_DEM_height = DEM_array.length
    const Result_array = []
    for (let i = 0; i < Tile_DEM_height; i++) {
        const col = []
        for (let j = 0; j < Tile_DEM_width; j++) {
            col.push(0)
        }
        Result_array.push(col)
    }
    for (let i = 0; i < Tile_DEM_height; i++) {
        const Result_i = i
        for (let j = 0; j < Tile_DEM_width - 1; j++) {
            const Result_j = j
            const triggerx1 = (Tile_DEM_height - Result_i - 1) / RESOLUTION
            const triggery1 = (Result_j + 1) / RESOLUTION
            const triggerx2 = (Tile_DEM_height - Result_i) / RESOLUTION
            const triggery2 = (Result_j) / RESOLUTION
            if (DEM_array[i][j] > 0)
                Result_array[Result_i][Result_j] = afd(DEM_array, i, j, Tile_DEM_height, Tile_DEM_width, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggerx1 == Math.round(triggerx1)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdx1(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggery1 == Math.round(triggery1)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdy1(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggerx2 == Math.round(triggerx2)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdx2(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggery2 == Math.round(triggery2)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdy2(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
        }
    }
    return Result_array
}


const WIND_DIRECTIONs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const WINDDIRECTION_ANGLESs = [270, 247.5, 225, 202.5, 180, 157.5, 135, 112.5, 90, 67.5, 45, 22.5, 0, 337.5, 315, 292.5]

function calcFA(raster) {
    const WindFrequency = sg_wind['S24']
    const raster_list=[]
    for (const WIND_DIRECTION of WIND_DIRECTIONs) {
        const WINDDIRECTION_angle = WINDDIRECTION_ANGLESs[WIND_DIRECTIONs.indexOf(WIND_DIRECTION)]
        const WINDDIRECTION_theta = WINDDIRECTION_angle * Math.PI / 180

        const Result_array = tileFAD(raster, WINDDIRECTION_angle, WINDDIRECTION_theta)
        for (let i = 0; i < Result_array.length; i++) {
            for (let j = 0; j < Result_array[i].length; j++) {
                Result_array[i][j] *= WindFrequency[WIND_DIRECTIONs.indexOf(WIND_DIRECTION)]
            }    
        }
        fs.writeFileSync('test/result_' + WIND_DIRECTION + '.txt', JSON.stringify(Result_array))
        // ResultRaster = arcpy.NumPyArrayToRaster(Result_array,lowerLeft,x_cell_size=1)
        // arcpy.DefineProjection_management(ResultRaster, spatialReference)
        // raster_list.push(ResultRaster)
    }
    // FAD_sum=CellStatistics(raster_list, "SUM", "NODATA")
    // FAD_sum=arcpy.CopyRaster_management(FAD_sum,Output_Layer_folder+"/"+Output_Layer_Name+"_FA"+".tif")
    // FADRaster=Aggregate(FAD_sum, RESOLUTION, "MEAN", "EXPAND", "DATA")
    // arcpy.CheckInExtension("Spatial")
    return raster
}

function pathToRaster(raster, rasterMinMax, shape, shapeHeight) {
    const bound = shape.shapeBounds()
    for (const i in bound) { bound[i] /= SCALE }
    const minmax = [9999999,9999999,-9999999,-9999999]
    for (let x = Math.floor((bound.left) - rasterMinMax[0]) + rasterMinMax[0] + 0.5; x < bound.right; x++ ) {
        for (let y = Math.floor((bound.top) - rasterMinMax[1]) + rasterMinMax[1] + 0.5; y < bound.bottom; y++ ) {
            const check = shape.pointInShape( { X: x * SCALE, Y: y * SCALE}, false, false)
            if (check) {
                const rx = x - 0.5 - rasterMinMax[0]
                const ry = raster.length -(y - 0.5 - rasterMinMax[1]) - 1
                minmax[0] = Math.min(rx, minmax[0])
                minmax[1] = Math.min(ry, minmax[1])
                minmax[2] = Math.max(rx, minmax[2])
                minmax[3] = Math.max(ry, minmax[3])
                raster[ry][rx] = Math.max(raster[ry][rx], shapeHeight)
            }
        }
    }
}

async function simToRaster(simFileStr, bottomLeft) {
    const sim = new SIMFuncs()
    await sim.io.ImportData(simFileStr, 'sim')
    const pgons = sim.query.Get('pg', null)
    let shapeData = {}
    const minmax = [99999, 99999, -99999, -99999]
    for (const pgon of pgons) {
        const pgonNorm = sim.calc.Normal(pgon, 1)
        if (pgonNorm[2] === 0) { continue }
        const ps = sim.query.Get('ps', [pgon])
        const psCoords = sim.attrib.Get(ps, 'xyz')
        let height = 0
        const pgShape = new Shape([psCoords.map(coord => {
            height = Math.max(height, coord[2])
            const cCoord = proj_obj_mob_svy.forward([coord[0], coord[1]])
            minmax[0] = Math.min(minmax[0], cCoord[0])
            minmax[1] = Math.min(minmax[1], cCoord[1])
            minmax[2] = Math.max(minmax[2], cCoord[0])
            minmax[3] = Math.max(minmax[3], cCoord[1])
            return { X: Math.round(cCoord[0] * SCALE), Y: Math.round(cCoord[1] * SCALE) }
        })])
        if (height === 0) { continue }
        pgShape.fixOrientation()
        if (!shapeData[height]) {
            shapeData[height] = pgShape
        } else {
            shapeData[height] = shapeData[height].union(pgShape)
        }
    }
    minmax[0] = Math.floor(minmax[0] - bottomLeft[0]) + bottomLeft[0] - 1
    minmax[1] = Math.floor(minmax[1] - bottomLeft[1]) + bottomLeft[1] - 1
    minmax[2] = Math.ceil(minmax[2] - bottomLeft[0]) + bottomLeft[0] + 1
    minmax[3] = Math.ceil(minmax[3] - bottomLeft[1]) + bottomLeft[1] + 1
    const cols = Math.round(minmax[2] - minmax[0])
    const rows = Math.round(minmax[3] - minmax[1])
    console.log(minmax, cols, rows)
    const raster = []
    for (let i = 0; i < rows; i++) {
        const row = []
        for (let j = 0; j < cols; j++) {
            row.push(0)
        }
        raster.push(row)
    }
    for (const h of Object.keys(shapeData)) {
        const shapes = shapeData[h].separateShapes()
        for (const s of shapes) {
            // const path = s.mapToLower()
            pathToRaster(raster, minmax, s, h)
        }
    }
    // const features = []
    // for (const h of Object.keys(shapeData)) {
    //     const shapes = shapeData[h].separateShapes()
    //     for (const s of shapes) {
    //         const path = s.mapToLower()
    //         const feature = JSON.parse(GEOJSON_FORMAT)
    //         feature.properties.height = h
    //         feature.geometry.coordinates = pathToGeom(path)
    //         features.push(feature)
    //     }
    // }

    // console.log(features)
    // const shapes = shape.separateShapes()
    return [raster, minmax]
}

async function test() {
    const bottomLeft = [24209.69458264282, 27735.61485516029]
    const simFile = fs.readFileSync('test_data.txt', { encoding: 'utf-8' })
    const [raster, rasterMinMax] = await simToRaster(simFile, bottomLeft)
    calcFA(raster)
    fs.writeFileSync('test/minmax.txt', `[${rasterMinMax[0]}, ${rasterMinMax[3]}]`)
}

test()

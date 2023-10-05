const fs = require('fs');

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

function tileFAD(DEM_array, x_start_valid, y_start_valid, WINDDIRECTION_angle, WINDDIRECTION_theta) {
    const Tile_DEM_width = DEM_array.shape[1]
    const Tile_DEM_height = DEM_array.shape[0]
    const Result_array = []
    for (let i = 0; i < Tile_DEM_height - y_start_valid; i++) {
        const col = []
        for (let j = 0; j < Tile_DEM_width - x_start_valid; j++) {
            col.push(0)
        }
        Result_array.push(col) 
    }
    for (let i = y_start_valid; i < Tile_DEM_height - y_start_valid; i++) {
        const Result_i = i
        for (let j = x_start_valid; j < Tile_DEM_width - 1; j ++) {
            const Result_j = j - x_start_valid
            const triggerx1 = (Tile_DEM_height - y_start_valid - Result_i - 1) / RESOLUTION
            const triggery1 = (Result_j + 1) / RESOLUTION
            const triggerx2 = (Tile_DEM_height - y_start_valid - Result_i) / RESOLUTION
            const triggery2 = (Result_j) / RESOLUTION
            if (DEM_array[i, j] > 0)
                Result_array[Result_i][Result_j] = afd(DEM_array, i, j, Tile_DEM_height, Tile_DEM_width, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggerx1 == int(triggerx1)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdx1(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggery1 == int(triggery1)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdy1(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggerx2 == int(triggerx2)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdx2(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
            if ((triggery2 == int(triggery2)) && (Result_array[Result_i][Result_j] == 0))
                Result_array[Result_i][Result_j] = afdy2(DEM_array, i, j, WINDDIRECTION_angle, WINDDIRECTION_theta)
        }
    }
    return Result_array
}


const WIND_DIRECTIONs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
const WINDDIRECTION_ANGLESs=[270,247.5,225,202.5,180,157.5,135,112.5,90,67.5,45,22.5,0,337.5,315,292.5]

// function calcFA(DEM_Layer_i,WindFrequency,Output_Layer_Name,Output_Layer_folder) {
//     raster_list=[]
//     arcpy.CheckOutExtension("Spatial")
//     for (const WIND_DIRECTION of WIND_DIRECTIONs) {
//         const WINDDIRECTION_angle = WINDDIRECTION_ANGLESs[WIND_DIRECTIONs.indexOf(WIND_DIRECTION)]
//         const WINDDIRECTION_theta = WINDDIRECTION_angle * Math.PI / 180

//         DEM_array=arcpy.RasterToNumPyArray(DEM,nodata_to_value=0)
//         Result_array=tileFAD(DEM_array,0,0,WINDDIRECTION_angle,WINDDIRECTION_theta)
//         Result_array=Result_array*WindFrequency[WIND_DIRECTIONs.index(WIND_DIRECTION)]
//         ResultRaster = arcpy.NumPyArrayToRaster(Result_array,lowerLeft,x_cell_size=1)
//         ResultRaster.save(Output_Layer_folder+"/"+Output_Layer_Name+"_"+WIND_DIRECTION+"_FA"+".tif")
//         arcpy.DefineProjection_management(ResultRaster, spatialReference)
//         raster_list.append(ResultRaster)
//     }
//     FAD_sum=CellStatistics(raster_list, "SUM", "NODATA")
//     FAD_sum=arcpy.CopyRaster_management(FAD_sum,Output_Layer_folder+"/"+Output_Layer_Name+"_FA"+".tif")
//     FADRaster=Aggregate(FAD_sum, RESOLUTION, "MEAN", "EXPAND", "DATA")
//     arcpy.CheckInExtension("Spatial")
//     return FADRaster
// }

function simToRaster(sim) {

}

// const simFile = fs.readFileSync('test_data.txt', {encoding: 'utf-8'})
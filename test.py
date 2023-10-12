import json
import numpy
import rasterio
from rasterio.crs import CRS

def saveraster(filename): 
    f = open(filename).read()
    splt = f.split('|||')
    dataList = json.loads('[' + splt[0] + ']')
    minmax = json.loads(splt[1])
    print(minmax[0], minmax[1])
    data = numpy.asarray(dataList, dtype=numpy.float64)
    print(data)
    print(data.shape)

    crs = CRS.from_string('+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 ' +
    '+k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 ' +
    '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs')

    outtransform = rasterio.Affine(1, 0, minmax[0], 0, -1, minmax[1])
    print(minmax)
    print(outtransform)
    merged_raster = rasterio.open(filename + '.tif', 'w', driver='GTiff',
                            height = data.shape[1], width = data.shape[2],
                            count=1, dtype='float64', nodata=0,
                            crs=crs,
                            transform=outtransform)
    merged_raster.write(data)


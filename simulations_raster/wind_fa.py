import arcpy
from arcpy import env
from arcpy.sa import *
import math
import time
import numpy
import gc
import sys
import os
import shutil
import xlwt
import types


global pi
pi = math.pi
global EPSILON
EPSILON = 0.00001
global MAXHEIGHT,RESOLUTION,x_Tiles_num,y_Tiles_num,FAD_NAME,WindFrequency,WORKSPACE
WIND_DIRECTIONs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
WINDDIRECTION_ANGLESs=[270,247.5,225,202.5,180,157.5,135,112.5,90,67.5,45,22.5,0,337.5,315,292.5]



def afdx1(DEM_array,m,n,WINDDIRECTION_angle,WINDDIRECTION_theta):
    h=DEM_array[m, n]
    if h >= MAXHEIGHT:h = MAXHEIGHT
    afdx1=0
    if (WINDDIRECTION_angle>0) and (WINDDIRECTION_angle<180):
        afdx1 = abs(Sin(WINDDIRECTION_theta)) * h
    return afdx1


def afdx2(DEM_array,m,n,WINDDIRECTION_angle,WINDDIRECTION_theta):
    h=DEM_array[m, n]
    if h >= MAXHEIGHT:h = MAXHEIGHT
    afdx2=0
    if (WINDDIRECTION_angle>180) and (WINDDIRECTION_angle<360):
        afdx2 = abs(Sin(WINDDIRECTION_theta)) * h
    return afdx2


def afdy1(DEM_array,m,n,WINDDIRECTION_angle,WINDDIRECTION_theta):
    h=DEM_array[m, n]
    if h >= MAXHEIGHT:h = MAXHEIGHT
    afdy1=0
    if (WINDDIRECTION_angle>90) and (WINDDIRECTION_angle<270):
        afdy1 = abs(Cos(WINDDIRECTION_theta)) * h 
    return afdy1

def afdy2(DEM_array,m,n,WINDDIRECTION_angle,WINDDIRECTION_theta):
    h=DEM_array[m, n]
    if h >= MAXHEIGHT:h = MAXHEIGHT
    afdy2=0
    if (WINDDIRECTION_angle>270) or (WINDDIRECTION_angle<90):
        afdy2 =abs(Cos(WINDDIRECTION_theta)) * h
    return afdy2

def afd(DEM_array,m,n,Tile_DEM_height,Tile_DEM_width,WINDDIRECTION_angle,WINDDIRECTION_theta):
    h=DEM_array[m, n]
    if h >= MAXHEIGHT:h = MAXHEIGHT
    afd = 0
    
    if math.sin(WINDDIRECTION_theta)>0:dx = 1
    elif math.sin(WINDDIRECTION_theta)<0 : dx=-1
    else:dx=0
    
    if math.cos(WINDDIRECTION_theta)>0:dy=-1
    elif math.cos(WINDDIRECTION_theta)<0: dy=1
    else:dy=0

    x=m+dx
    y=n+dy

    if((x >= 0) & (x <= Tile_DEM_height - 1)):
        hdx = DEM_array[x, n]
        #print(hdx)
        if (hdx >= MAXHEIGHT): hdx = MAXHEIGHT
        if ((round(h,4) - round(hdx,4))> EPSILON):afd = afd + abs(Sin(WINDDIRECTION_theta)) * (h - hdx)

    if((y >= 0) & (y <= Tile_DEM_width - 1)):
        hdy = DEM_array[m, y]
        if (hdy >= MAXHEIGHT): hdy = MAXHEIGHT
        if ((round(h,4) - round(hdy,4)) > EPSILON): afd = afd + abs(Cos(WINDDIRECTION_theta)) * (h - hdy)
    afd=round(afd,4)
    return afd

def Tile_fad(DEM_array,x_start_valid,y_start_valid,WINDDIRECTION_angle,WINDDIRECTION_theta):
    Tile_DEM_width=DEM_array.shape[1]
    Tile_DEM_height=DEM_array.shape[0]
    Result_array=numpy.zeros((Tile_DEM_height-y_start_valid,Tile_DEM_width-x_start_valid))
    for i in range(y_start_valid,Tile_DEM_height-y_start_valid): # notice that i is from top
        Result_i=i
        for j in range(x_start_valid,Tile_DEM_width-1):
            Result_j=j-x_start_valid
            triggerx1 = float(Tile_DEM_height-y_start_valid-Result_i - 1) / RESOLUTION
            triggery1 = float(Result_j + 1) / RESOLUTION
            triggerx2 = float(Tile_DEM_height-y_start_valid-Result_i) / RESOLUTION
            triggery2 = float(Result_j) / RESOLUTION
            if (DEM_array[i,j]>0):
                Result_array[Result_i, Result_j] = afd(DEM_array,i, j,Tile_DEM_height,Tile_DEM_width,WINDDIRECTION_angle,WINDDIRECTION_theta)
                if ((triggerx1 == int(triggerx1)) & (Result_array[Result_i, Result_j]==0)):
                    Result_array[Result_i, Result_j] = afdx1(DEM_array,i, j,WINDDIRECTION_angle,WINDDIRECTION_theta)
                if ((triggery1 == int(triggery1)) & (Result_array[Result_i, Result_j]==0)):
                    Result_array[Result_i, Result_j] = afdy1(DEM_array,i, j,WINDDIRECTION_angle,WINDDIRECTION_theta)
                if ((triggerx2 == int(triggerx2)) & (Result_array[Result_i, Result_j]==0)):
                    Result_array[Result_i, Result_j] = afdx2(DEM_array,i, j,WINDDIRECTION_angle,WINDDIRECTION_theta)
                if ((triggery2 == int(triggery2)) & (Result_array[Result_i, Result_j]==0)):
                    Result_array[Result_i, Result_j] = afdy2(DEM_array,i, j,WINDDIRECTION_angle,WINDDIRECTION_theta)
            del Result_j
        del Result_i
    del DEM_array                                                        
    return Result_array

def cal_Frontal_Area_Density_singleDEM(DEM_Layer_i,WindFrequency,Output_Layer_Name,Output_Layer_folder):
    raster_list=[]
    arcpy.CheckOutExtension("Spatial")
    for WIND_DIRECTION in WIND_DIRECTIONs:
        arcpy.AddMessage("Processing {0} Direction".format(WIND_DIRECTION))
        print("Processing {0} Direction".format(WIND_DIRECTION))
        WINDDIRECTION_angle=WINDDIRECTION_ANGLESs[WIND_DIRECTIONs.index(WIND_DIRECTION)]
        WINDDIRECTION_theta=math.radians(WINDDIRECTION_angle)
        DEM_array=arcpy.RasterToNumPyArray(DEM,nodata_to_value=0)
        Result_array=Tile_fad(DEM_array,0,0,WINDDIRECTION_angle,WINDDIRECTION_theta)
        Result_array=Result_array*WindFrequency[WIND_DIRECTIONs.index(WIND_DIRECTION)]
        ResultRaster = arcpy.NumPyArrayToRaster(Result_array,lowerLeft,x_cell_size=1)
        ResultRaster.save(Output_Layer_folder+"/"+Output_Layer_Name+"_"+WIND_DIRECTION+"_FA"+".tif")
        arcpy.DefineProjection_management(ResultRaster, spatialReference)
        raster_list.append(ResultRaster)
        del ResultRaster,Result_array,DEM_array
        if arcpy.Exists("in_memory"):
            arcpy.Delete_management("in_memory")
        gc.collect()
    FAD_sum=CellStatistics(raster_list, "SUM", "NODATA")
    FAD_sum=arcpy.CopyRaster_management(FAD_sum,Output_Layer_folder+"/"+Output_Layer_Name+"_FA"+".tif")
    FADRaster=Aggregate(FAD_sum, RESOLUTION, "MEAN", "EXPAND", "DATA")
    for raster in raster_list:arcpy.Delete_management(raster)
    arcpy.CheckInExtension("Spatial")
    if arcpy.Exists("in_memory"):arcpy.Delete_management("in_memory")
    gc.collect()
    return FADRaster


######################################################################################################

###input parameters
##RASTER_DEM="data path"
##RESOLUTION=200 # can change
##MAXHEIGHT=27 # can change
##WindFrequency_path="txt file path"
##WORKSPACE="result location"
##FAD_NAME="result name"

###input parameters
RASTER_DEM=r"C:\Users\hwhwo\scripts\software_development\ARCGIS_toolbox_development\FAD_Calculator_ver2_test\test_data_fine_scale\building_height_for_fine_scale.tif"
RESOLUTION=100 # can change
MAXHEIGHT=27 # can change
WindFrequency_path=r"C:\Users\hwhwo\scripts\software_development\ARCGIS_toolbox_development\FAD_Calculator_ver2_test\test_data_fine_scale\wind frequency.txt"
WORKSPACE="C:/Users/hwhwo/scripts/software_development/ARCGIS_toolbox_development/FAD_Calculator_ver2_test/test_result/"
FAD_NAME="result_name1"


#initial parameters
env.workspace=WORKSPACE
arcpy.env.overwriteOutput = True
env.scratchWorkspace=WORKSPACE
arcpy.env.compression = "LZW"


try:
    if arcpy.Exists(FAD_NAME+".tif"): raise Exception(FAD_NAME +".tif already exists, please change a FAD result dataset name")
except:
    arcpy.AddError(FAD_NAME +".tif already exists, please change a FAD result dataset name")


try:
    with open(WindFrequency_path, "r") as f:
        data = f.read()
        WindFrequency=list(map(float,data.split()))
        if((sum(WindFrequency)<0.98) | (sum(WindFrequency)>1.02) | (len(WindFrequency)!=16)):
            raise Exception("bad wind frequency data")
        else:
            arcpy.AddMessage("Wind Frequency : {0}".format(WindFrequency))
            print("Wind Frequency : {0}".format(WindFrequency))
            
except:
    f.close()
    arcpy.AddError("bad wind frequency data")


DEM=arcpy.Raster(RASTER_DEM)
DEM_width=DEM.width
DEM_height=DEM.height
lowerLeft = arcpy.Point(DEM.extent.XMin, DEM.extent.YMin)
NoDataValue=DEM.noDataValue
spatialReference=DEM.spatialReference

Array_Max_Length=2000

try:
    if ((DEM_width<Array_Max_Length) & (DEM_height<Array_Max_Length)):
        FAD=cal_Frontal_Area_Density_singleDEM(DEM,WindFrequency,FAD_NAME,env.scratchWorkspace)
    else:
        arcpy.AddError("Raster Dataset is large and it may take a long time")
    FAD.save(FAD_NAME+".tif")
    if arcpy.Exists("in_memory"):arcpy.Delete_management("in_memory")
    gc.collect()
    arcpy.CheckInExtension("Spatial")
    print("finished")

    
except:
    if arcpy.Exists("in_memory"):arcpy.Delete_management("in_memory")
    gc.collect()
    arcpy.CheckInExtension("Spatial")
    arcpy.AddError("An exception occurred during frontal area calculation")
    print("An exception occurred during frontal area calculation")


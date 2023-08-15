const fs = require('fs');
(async function loadTiff() {
    const geotiff = await import('geotiff');
    const filedata = fs.readFileSync('assets/FA/FA.tif').buffer
    console.log(filedata)
    const image = await geotiff.fromArrayBuffer(filedata);
    console.log(image)
})()
  
const GRID_SIZE = 10;
// =================================================================================================
// execute the modle generation
async function execute(sim, config, gridSize = GRID_SIZE) {
    // // initiate the function class
    // const sim = new SIMFuncs();
    // // import model data
    // try {
    //     sim.io.ImportData(model_data, 'sim');
    // } catch(ex) {
    //     if (typeof model_data !== 'string') {
    //         console.log(model_data);
    //     } else {
    //         console.log(model_data.slice(0, 200));
    //     }
    //     throw(ex)
    // }
    // add an attribute for obstructiobs
    // sim.attrib.Add('pg', 'boolean', 'obstruction');
    // set geolocation
    sim.io.Geolocate([config["latitude"], config["longitude"]], 0, 0);
    // get all pg
    const pgons = sim.query.Get('pg', null);
    // update attributes and colours
    processSite(sim, pgons, gridSize);
    processFacade(sim, pgons);
    processObstructions(sim, pgons);
    processWalkways(sim, pgons);
    processOther(sim, pgons);
    // export sim model
    const new_model_data = await sim.io.ExportData(null, 'sim');
    return new_model_data;
}
// -------------------------------------------------------------------------------------------------
// function processSite(sim, pgons, gridSize) {
//     // get the site polygon
//     const site = sim.query.Filter(pgons, 'type', '==', 'site');
//     const site_off = sim.poly2d.OffsetMitre(site, 0, 1, 'square_end');
//     // get the bases of any obstructions, to be used to boolean holes in the grid
//     const obstructions = sim.query.Filter(pgons, 'type', '==', 'obstruction');
//     const obstruction_posis = sim.query.Get('ps', obstructions);
//     sim.attrib.Push(obstruction_posis, ['xyz', 2, 'z'], 'pg' );
//     const bases = sim.query.Filter(pgons, 'z', '==', 0);
//     const bases_off = sim.poly2d.OffsetMitre(bases, 0, 1, 'square_end');
//     // create a grid that covers the whole site
//     const [cen, _, __, size] = sim.calc.BBox(site);
//     const num_edges = [Math.ceil(size[0]/gridSize), Math.ceil(size[1]/gridSize)];
//     const grid_posis = sim.pattern.Grid([cen[0], cen[1], 0], 
//         [num_edges[0] * gridSize, num_edges[1] * gridSize],
//         [num_edges[0] + 1,         num_edges[1] + 1], 'quads');
//     const grid_pgons0 = sim.make.Polygon(grid_posis);
//     // intersect the grid with the site
//     const grid_pgons1 = sim.poly2d.Boolean(grid_pgons0, site_off, 'intersect');
//     const grid_pgons2 = sim.poly2d.Boolean(grid_pgons1, bases_off, 'difference');
//     // make sure that all resulting pgons are facing up
//     for (const pgon of grid_pgons2) {
//         const norm = sim.calc.Normal(pgon, 1);
//         if (norm[2] < 0) { sim.edit.Reverse(pgon); }
//     }
//     // clean up
//     sim.edit.Delete([grid_pgons0, grid_pgons1, bases_off, site_off], 'delete_selected');
//     // move the grid up by 1 m
//     sim.modify.Move(grid_pgons2, [0,0,1]);
//     // set attribs
//     sim.attrib.Set(grid_pgons2, 'type', 'ground', 'one_value');
//     // update colour
//     sim.visualize.Color(site, sim.inl.colFromStr('lightgreen'));
// }
// -------------------------------------------------------------------------------------------------
function processSite(sim, pgons, gridSize) {
    // get the site polygon
    const site = sim.query.Filter(pgons, 'type', '==', 'site');
    const site_off = sim.poly2d.OffsetMitre(site, 0, 1, 'square_end');
    // get the bases of any obstructions, to be used to boolean holes in the grid
    const obstructions = sim.query.Filter(pgons, 'type', '==', 'obstruction');
    const obstruction_posis = sim.query.Get('ps', obstructions);
    sim.attrib.Push(obstruction_posis, ['xyz', 2, 'z'], 'pg' );
    // create a grid that covers the whole site
    const [cen, _, __, size] = sim.calc.BBox(site);
    const num_edges = [Math.ceil(size[0]/gridSize), Math.ceil(size[1]/gridSize)];
    const grid_posis = sim.pattern.Grid([cen[0], cen[1], 0], 
        [num_edges[0] * gridSize, num_edges[1] * gridSize],
        [num_edges[0] + 1,         num_edges[1] + 1], 'quads');
    const grid_pgons0 = sim.make.Polygon(grid_posis);
    // intersect the grid with the site
    const grid_pgons2 = sim.poly2d.Boolean(grid_pgons0, site_off, 'intersect');
    // make sure that all resulting pgons are facing up
    for (const pgon of grid_pgons2) {
        const norm = sim.calc.Normal(pgon, 1);
        if (norm[2] < 0) { sim.edit.Reverse(pgon); }
    }
    // clean up
    sim.edit.Delete([grid_pgons0, site_off], 'delete_selected');
    // move the grid up by 1 m
    sim.modify.Move(grid_pgons2, [0,0,1]);
    // set attribs
    sim.attrib.Set(grid_pgons2, 'type', 'ground', 'one_value');
    // update colour
    sim.visualize.Color(site, sim.inl.colFromStr('lightgreen'));
}
// -------------------------------------------------------------------------------------------------
function processFacade(sim, pgons) {
    const facades = sim.query.Filter(pgons, 'type', '==', 'facade');
    // move facades out by 0.1m
    const normals = sim.calc.Normal(facades, 0.1); 
    sim.modify.Move(facades, normals);
    // update colour
    sim.visualize.Color(facades, sim.inl.colFromStr('aqua'));
}
// -------------------------------------------------------------------------------------------------
function processObstructions(sim, pgons) {
    const obstructions = sim.query.Filter(pgons, 'type', '==', 'obstruction');
    sim.attrib.Set(obstructions, 'obstruction', true);
    const walls = [];
    const roofs = [];
    for (const obstruction of obstructions) {
        // if facing up, then make it roof, otherwise walls
        const normal = sim.calc.Normal(obstruction, 1);
        if (normal[2] > 0.5) {
            roofs.push(obstruction);
        } else {
            walls.push(obstruction);
        }
    }
    // update colour
    sim.visualize.Color(walls, sim.inl.colFromStr('beige'));
    sim.visualize.Color(roofs, sim.inl.colFromStr('tan'));
}
// -------------------------------------------------------------------------------------------------
function processWalkways(sim, pgons) {
    const walkways = sim.query.Filter(pgons, 'type', '==', 'walkway');
    // walksways will be added to sim obstructions
    // tests show only a 3% slowdown in the simulation due to the extra obstructions
    sim.attrib.Set(walkways, 'obstruction', true); 
    // update colour
    sim.visualize.Color(walkways, sim.inl.colFromStr('seashell'));
}
// -------------------------------------------------------------------------------------------------
function processOther(sim, pgons) {
    const others = sim.query.Filter(pgons, 'type', '==', 'other');
    // update colour
    sim.visualize.Color(others, sim.inl.colFromStr('lightgreen'));
}

// =================================================================================================
module.exports = {
    execute: execute,
    processObstructions: processObstructions
}
/** Compatibility projections for the staged reducer migration. */
export function positionsMapFromArray(positions=[]){const map={};for(const p of positions){const key=p?.poolAddress??p?.asset;if(key)map[key]=p;}return map;}
export function positionsArrayFromMap(positions={}){return Object.values(positions).filter(Boolean);}
export function projectExecutionState(state){const isArray=Array.isArray(state.positions);const map=state.positionsByPool??(isArray?positionsMapFromArray(state.positions):state.positions)??{};return {...state,positionsByPool:Array.isArray(map)?positionsMapFromArray(map):map,positions:isArray?state.positions:positionsArrayFromMap(map)};}

export async function api<T>(path:string,method='GET',data?:unknown):Promise<T>{
  const r=await fetch(`/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const b=await r.json();
  if(!r.ok)throw new Error(typeof b.detail==='string'?b.detail:'요청을 처리할 수 없습니다.');
  return b;
}

export const freshSeed=()=>Math.floor(Math.random()*2147483647);
export const SIDE_NAMES={cyan:'AEGIS',amber:'EMBER'} as const;

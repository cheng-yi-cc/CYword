import { getUserFromRequest } from '../../server/auth.ts';
import { jsonError, readRequestJson } from '../../server/book-api.ts';
import { incrementalProtocol, IncrementalInputError } from '../../server/incremental-schema.ts';
import { readIncrementalPage, stageIncrementalPart, commitIncrementalBatch } from '../../server/incremental-store.ts';

const revision = (value:unknown) => Number.isSafeInteger(value) && Number(value)>=0;
const batchId = (value:unknown) => typeof value==='string' && /^[a-f0-9-]{36}$/.test(value);
export const onRequest:PagesFunction<Env> = async({request,env})=>{
  if(request.method!=='POST')return jsonError(405,'Method not allowed',{Allow:'POST'});
  if(!env.DB||!env.JWT_SECRET||env.JWT_SECRET.length<32)return jsonError(503,'同步服务暂时不可用');
  try{
    const user=await getUserFromRequest(request,env.DB,env.JWT_SECRET);
    if(!user)return jsonError(401,'登录已过期，请重新登录后同步');
    let input:any;
    try{input=await readRequestJson(request,96000);}catch(error){return jsonError(error instanceof RangeError?413:400,'增量请求格式无效或过大');}
    if(!input||input.protocol!==2||input.bookCode!==incrementalProtocol.bookCode||input.curriculumVersion!==incrementalProtocol.curriculumVersion)
      return jsonError(400,'同步协议或词书计划版本不匹配，请更新应用');
    let result:any;
    if(input.action==='read'){
      if(!revision(input.after)||typeof input.cursor!=='string'||input.cursor.length>160||!/^[a-zA-Z0-9/_:-]*$/.test(input.cursor))return jsonError(400,'增量读取参数无效');
      result=await readIncrementalPage(env.DB,user.id,input.after,input.cursor);
    }else if(input.action==='stage'){
      if(!batchId(input.batchId)||!revision(input.revision)||!Number.isInteger(input.parts)||input.parts<1||input.parts>512
        ||!Number.isInteger(input.part)||input.part<0||input.part>=input.parts||!Array.isArray(input.records)||input.records.length<1||input.records.length>24)
        return jsonError(400,'增量批次参数无效');
      result=await stageIncrementalPart(env.DB,user.id,input);
    }else if(input.action==='commit'){
      if(!batchId(input.batchId)||!revision(input.revision))return jsonError(400,'增量提交参数无效');
      result=await commitIncrementalBatch(env.DB,user.id,input.batchId,input.revision);
      if(result.status===400)return jsonError(400,'学习或复习前置条件不满足，原进度已保留');
    }else return jsonError(400,'未知同步操作');
    const {status=200,...data}=result;
    return Response.json({...incrementalProtocol,...data},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){
    if(error instanceof IncrementalInputError)return jsonError(400,error.message);
    console.error('[CYWORD INCREMENTAL]',error instanceof Error?error.name:'Unexpected failure');
    return jsonError(503,'同步暂时失败，本机记录仍保留，请稍后重试');
  }
};

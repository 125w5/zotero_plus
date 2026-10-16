/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Convert remote failures to a small, local vocabulary. Provider messages can
// contain echoed prompts, URLs and credentials; they are diagnostic input only.
const PARAMETERS=new Set(['max_tokens','max_completion_tokens','reasoning_effort','thinking','stream','stream_options','tools','tool_choice','messages','model','response_format']);
const STATUS=/^服务返回 HTTP [4-5]\d{2}$/;
// These are complete local messages created by requestProvider. Recognizing a
// class alone is insufficient: an arbitrary provider message with that name
// must never be displayed or written to a diagnostic artifact.
const LOCAL_ERRORS = new Map([
 ['ProviderTransportError', new Set(['无法连接服务，请检查网络或代理'])],
 ['ProviderResponseError', new Set(['服务已连接，但返回内容无法读取，请重试', '模型流式响应格式不完整，请重试', '模型响应在完成前中断，请重试'])],
 ['AbortError', new Set(['服务请求已取消'])],
 ['TimeoutError', new Set(['服务请求超时，请重试'])],
 ['Error', new Set(['后台网络环境不可用，请重新打开软件'])],
]);
function diagnostic(status,code='',param=''){
 const base='服务返回 HTTP '+status;
 if(code==='unsupported_parameter'&&PARAMETERS.has(param))return base+'：接口不支持参数 '+param+'，请调整模型兼容设置';
 if(code==='invalid_parameter'&&PARAMETERS.has(param))return base+'：参数 '+param+' 不符合接口要求，请检查模型兼容设置';
 if(code==='context_length_exceeded')return base+'：本次论文与对话超出模型上下文，请减少附加资料或新建对话';
 if(code==='model_not_found')return base+'：当前配置的模型不可用，请在设置中选择已开通的模型';
 if(code==='invalid_tool_schema')return base+'：应用工具的参数格式与接口不兼容，本轮未执行工具';
 if(code==='invalid_messages')return base+'：对话或工具消息格式与接口不兼容，本轮未执行工具';
 return base;
}
function classify(value){
 const row=value?.error&&typeof value.error==='object'?value.error:value||{},code=String(row.code||row.type||'').slice(0,96).toLowerCase(),message=String(row.message||'').slice(0,12000).toLowerCase();
 // Compatible services often report a JSON path such as tools[0].function
 // or messages.2.tool_calls. Preserve only the known top-level parameter;
 // neither a raw path nor an echoed unknown value belongs in UI diagnostics.
 const parameterRoot=typeof row.param==='string'?row.param.match(/^([a-z_]+)(?:[.\[]|$)/)?.[1]:'';
 let param=PARAMETERS.has(parameterRoot)?parameterRoot:'';
 // Only extract one known parameter name. Never copy remote prose to the UI.
 if(!param)for(const name of PARAMETERS)if(new RegExp('(?:^|[^a-z_])'+name+'(?:$|[^a-z_])').test(message)){param=name;break;}
 if(/context_length_exceeded|context_window_exceeded/.test(code)||/maximum context length|context length exceeded|too many tokens/.test(message))return {code:'context_length_exceeded',param:''};
 if(/model_not_found|model_not_supported/.test(code)||/model.*(?:not found|does not exist|not available|not supported)/.test(message))return {code:'model_not_found',param:''};
 if(/invalid_json_schema|invalid_tool_schema/.test(code)||/invalid schema.*(?:function|tool)|(?:function|tool).*invalid schema/.test(message))return {code:'invalid_tool_schema',param:''};
 if(/invalid_messages?|invalid_tool_calls?/.test(code)||/tool_call.*(?:must|missing|without)|tool.*(?:response|message).*(?:missing|must)|messages.*(?:invalid|must)/.test(message))return {code:'invalid_messages',param:''};
 if(param&&(/unsupported_parameter/.test(code)||/unsupported parameter|not supported|does not support|unknown parameter|unrecognized request argument/.test(message)))return {code:'unsupported_parameter',param};
 if(param&&(/invalid_parameter|invalid_value|unsupported_value/.test(code)||/must be|out of range|invalid value/.test(message)))return {code:'invalid_parameter',param};
 return {code:'',param:''};
}
export function providerHTTPError(status,payload){
 const safeStatus=Number.isInteger(status)&&status>=400&&status<=599?status:500,{code,param}=classify(payload);
 const row=payload?.error&&typeof payload.error==='object'?payload.error:payload||{},message=String(row.message||'').slice(0,12000);
 const imageUnsupported=[400,415,422].includes(safeStatus)&&/image|vision|multimodal|图片|图像/i.test(message)&&/not support|unsupported|invalid image|unknown.*image|image.*not allowed|不支持/i.test(message);
 return Object.assign(new Error(diagnostic(safeStatus,code,param)),{name:'ProviderRequestError',providerStatus:safeStatus,providerCode:code,providerParam:param,...(imageUnsupported?{imageUnsupported:true}:{})});
}
export function safeProviderError(error){
 const status=error?.providerStatus,code=error?.providerCode,param=error?.providerParam;
 if(Number.isInteger(status)&&status>=400&&status<=599){const expected=diagnostic(status,code,param);if(error.message===expected)return expected;}
 if(LOCAL_ERRORS.get(error?.name)?.has(error?.message))return error.message;
 return STATUS.test(String(error?.message||''))?error.message:null;
}
export async function providerResponseError(response){
 let text='',reader;const limit=16384;
 try{
  if(response.body?.getReader){reader=response.body.getReader();const decoder=new TextDecoder();let bytes=0;
   while(bytes<limit){const {value,done}=await reader.read();if(done){text+=decoder.decode();break;}const take=value.subarray(0,limit-bytes);bytes+=take.byteLength;text+=decoder.decode(take,{stream:true});}
  }else if(response.text)text=String(await response.text()).slice(0,limit);
 }catch(_){/* An unreadable error body still has its HTTP status. */}
 finally{if(reader){try{await reader.cancel();}catch(_){}try{reader.releaseLock();}catch(_){}}}
 let payload;try{payload=JSON.parse(text);}catch(_){payload=null;}
 return providerHTTPError(response.status,payload);
}

/* SPDX-License-Identifier: AGPL-3.0-or-later */
const dimension=(value,max)=>{const number=Number(value);if(!Number.isFinite(number)||number<1||number>max)throw Error('图片尺寸超出页面范围');return Math.round(number*10)/10;};
export function resizedImage(block,key,value,ratio){if(!['width','height'].includes(key))throw Error('图片尺寸无效');const result={...block,[key]:dimension(value,key==='width'?158:240)};
 if(block.aspectLocked!==false&&Number.isFinite(ratio)&&ratio>0){if(key==='width'){result.height=result.width/ratio;if(result.height>240){result.height=240;result.width=240*ratio;}}else{result.width=result.height*ratio;if(result.width>158){result.width=158;result.height=158/ratio;}}for(const name of ['width','height'])result[name]=Math.max(.001,Math.round(result[name]*1000)/1000);}
 return {width:result.width,height:result.height};
}
export function applyImageGeometry(image,block){image.style.width=Number.isFinite(block.width)&&block.width>0?block.width+'mm':'';image.style.height=Number.isFinite(block.height)&&block.height>0?block.height+'mm':'auto';image.style.objectFit=block.aspectLocked===false?'fill':'contain';image.style.maxWidth='100%';}

export function deliveryMatrixVersion(matrix,packageVersion){
 const version=String(matrix).match(/^当前版本 (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|[，。]|$)/m)?.[1];
 if(!version)throw new Error('当前功能矩阵缺少完整版本号');
 if(version!==packageVersion)throw new Error('当前功能矩阵版本与 package.json 不一致');
 return version;
}

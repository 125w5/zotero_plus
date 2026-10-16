// Keep the evidence list compact and scoped to the reader's research pane.
export const assetReaderStyle = `
#easysch-asset-panel{position:fixed;right:0;top:41px;bottom:0;width:min(420px,85vw);box-sizing:border-box;background:var(--material-sidepane,#f8f8f7);color:var(--fill-primary,CanvasText);border-left:1px solid var(--fill-quinary,#e1e3e6);z-index:10000;padding:10px;overflow:auto;font:12.5px/1.5 system-ui,'Microsoft YaHei',sans-serif}
#easysch-asset-panel.embedded-evidence{position:static;width:100%;border:0;padding:0;overflow:visible;background:transparent}
#easysch-asset-panel.embedded-evidence>header{display:none}
#easysch-asset-panel [hidden]{display:none!important}
#easysch-asset-panel button{display:inline-flex!important;align-items:center;justify-content:center;width:auto!important;height:auto!important;min-width:0!important;font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:5px;padding:4px 8px;margin:0;cursor:pointer}
#easysch-asset-panel button:hover{background:var(--material-mix-quinary,#e8eaed)}
#easysch-asset-panel :is(button,input,select,summary):focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
#easysch-asset-panel img{display:block!important;width:100%;height:auto;max-height:240px;object-fit:contain;background:white;margin:0 0 8px}
#easysch-asset-panel .asset-preview-trigger{cursor:zoom-in;border-radius:6px;transition:filter .15s ease,transform .15s ease}
#easysch-asset-panel .asset-preview-trigger:hover{filter:brightness(.94);transform:translateY(-1px)}
#easysch-asset-panel .asset-preview-trigger:focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
#easysch-asset-panel p{margin:6px 0}
#easysch-asset-panel summary{cursor:pointer;margin:6px 0}
#easysch-asset-panel :is(input,select){box-sizing:border-box;font:inherit;color:inherit;background:var(--material-background,Canvas);border:1px solid var(--fill-quinary,#e1e3e6);border-radius:6px;padding:5px 7px}
#easysch-asset-panel input::placeholder{color:var(--fill-secondary,GrayText);opacity:1}
#easysch-asset-panel header{display:flex;align-items:center;justify-content:space-between}
#easysch-asset-panel .asset-error{color:var(--accent-red,#b43428);font-size:12px}
#easysch-asset-panel .asset-explanation{font-size:13px;line-height:1.65}
#easysch-asset-panel .asset-muted{color:var(--fill-secondary,GrayText);font-size:11px}
#easysch-asset-panel .asset-status{font-size:11px;color:var(--fill-secondary,GrayText);margin:3px 0;overflow-wrap:anywhere}
#easysch-asset-panel .asset-task-actions:empty{display:none}
#easysch-asset-panel .asset-search-row{display:flex;align-items:center;gap:5px;margin:6px 0 8px}
#easysch-asset-panel .asset-search-row input{flex:1;min-width:0;width:auto;margin:0;border-radius:7px}
#easysch-asset-panel .asset-search-row select{flex:none;width:64px;border-radius:7px;font-size:11px;padding-inline:4px}
#easysch-asset-panel .asset-evidence-row{--asset-mark:#bfcde0;position:relative;box-sizing:border-box;margin:0;padding:0;border:0;border-bottom:1px solid var(--fill-quinary,#eeefed);border-radius:0;background:transparent;box-shadow:none}
#easysch-asset-panel .asset-evidence-row[data-kind=table]{--asset-mark:#cfccb8}
#easysch-asset-panel .asset-evidence-row[data-kind=formula]{--asset-mark:#c8bfd6}
#easysch-asset-panel .asset-row-heading{display:flex;align-items:center;gap:2px;min-height:40px;padding:0 2px 0 8px;position:relative;border-radius:4px;transition:background .12s ease}
#easysch-asset-panel .asset-row-heading::before{content:'';position:absolute;left:1px;top:50%;width:4px;height:14px;border-radius:3px;transform:translateY(-50%);background:var(--asset-mark)}
#easysch-asset-panel .asset-row-heading:hover,#easysch-asset-panel .asset-row-heading:focus-within,#easysch-asset-panel .asset-evidence-row[data-expanded=true]>.asset-row-heading{background:var(--material-mix-quinary,#eeefed)}
#easysch-asset-panel .asset-row-toggle{flex:1;min-width:0!important;justify-content:flex-start!important;gap:6px;padding:7px 2px!important;border:0;text-align:left;background:transparent!important}
#easysch-asset-panel .asset-icon-button svg{width:15px;height:15px;flex:none;display:block;color:var(--fill-secondary,#858c95)}
#easysch-asset-panel .asset-row-toggle>svg{width:10px;height:10px;transition:transform .12s ease}
#easysch-asset-panel .asset-evidence-row[data-expanded=true] .asset-row-toggle>svg{transform:rotate(90deg)}
#easysch-asset-panel .asset-row-text{display:flex;align-items:baseline;gap:7px;min-width:0;flex:1}
#easysch-asset-panel .asset-row-label{flex:none;max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:400}
#easysch-asset-panel .asset-row-page{flex:none;color:var(--fill-secondary,GrayText);font-size:10px;white-space:nowrap}
#easysch-asset-panel .asset-row-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fill-secondary,GrayText);font-size:11px}
#easysch-asset-panel .asset-row-actions{display:flex;align-items:center;gap:0;flex:none;opacity:.65;transition:opacity .12s ease}
#easysch-asset-panel .asset-row-heading:is(:hover,:focus-within) .asset-row-actions{opacity:1}
#easysch-asset-panel .asset-row-actions>.asset-icon-button{padding:4px!important;border:0!important;min-height:24px;min-width:23px!important;color:var(--fill-secondary,GrayText)}
#easysch-asset-panel .asset-row-actions>.asset-icon-button:active{background:var(--material-mix-quinary,#e0e2e5);transform:translateY(1px)}
#easysch-asset-panel .asset-row-content{padding:9px 10px 12px 22px;background:var(--material-background,Canvas)}
#easysch-asset-panel .asset-row-content>details{margin:4px 0;font-size:11px;color:var(--fill-secondary,GrayText)}
#easysch-asset-panel .asset-summary{font-size:12px;line-height:1.65;margin:8px 0;overflow-wrap:anywhere}
#easysch-asset-panel .asset-explanation{font-size:12px;line-height:1.65;overflow-wrap:anywhere}
#easysch-asset-panel .asset-explanation>strong{display:block;margin:10px 0 3px;font-size:12px;font-weight:500}
#easysch-asset-panel .asset-explanation .asset-muted{display:block;margin:5px 0}
#easysch-asset-panel .asset-crop-area{margin:9px 0;padding-top:8px;border-top:1px solid var(--fill-quinary,#e1e3e6)}
#easysch-asset-panel .asset-context-menu{position:fixed;z-index:2147483646;display:flex;flex-direction:column;min-width:140px;padding:4px;border:1px solid var(--fill-quinary,#dfe2e6);border-radius:8px;background:var(--material-background,Canvas);box-shadow:0 5px 22px #0002}
#easysch-asset-panel .asset-context-menu button{margin:0;padding:6px 9px;justify-content:flex-start;text-align:left;border:0;background:transparent;font-size:12px}
#easysch-asset-panel .asset-context-menu button:hover{background:var(--material-mix-quinary,#eeefed)}
#easysch-asset-panel .asset-context-menu button:disabled{opacity:.45;cursor:default}
.easysch-image-preview{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;box-sizing:border-box;padding:28px;background:rgba(25,33,44,.38);backdrop-filter:blur(5px);cursor:zoom-out}
.easysch-image-preview-content{display:flex;flex-direction:column;max-width:min(94vw,1280px);max-height:94vh;min-width:min(360px,90vw);overflow:hidden;border-radius:12px;background:var(--material-sidepane,Canvas);color:var(--fill-primary,CanvasText);box-shadow:0 18px 52px rgba(0,0,0,.35);cursor:default;font:menu}
.easysch-image-preview-heading,.easysch-image-preview-content footer{display:flex;align-items:center;gap:8px;padding:10px 14px}
.easysch-image-preview-heading{border-bottom:1px solid var(--fill-quinary,#d7dade)}
.easysch-image-preview-heading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;font-size:13px}
.easysch-image-preview-content>img{display:block;max-width:100%;max-height:calc(94vh - 112px);width:auto;height:auto;object-fit:contain;align-self:center;cursor:zoom-out;background:white}
.easysch-image-preview-content footer{border-top:1px solid var(--fill-quinary,#d7dade)}
.easysch-image-preview-content footer span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fill-secondary,GrayText);font-size:12px}
.easysch-image-preview-content button{width:auto!important;min-width:0!important;height:auto!important;padding:5px 10px;border:1px solid var(--fill-quinary,#d7dade);border-radius:7px;background:var(--material-button,ButtonFace);color:var(--fill-secondary,GrayText);font:inherit;cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px #00000008;transition:background .12s ease,transform .12s ease}
.easysch-image-preview-content button:hover{background:var(--material-mix-quinary,#ddd)}
.easysch-image-preview-content button:active{transform:translateY(1px);box-shadow:none}
.easysch-image-preview-content button:focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
@media(min-width:1100px){body:has(#easysch-asset-panel) :is(#split-view,.split-view){inset-inline-end:420px!important}}
`;

// Use the Reader's own theme tokens; keep changes scoped to the research pane.
export const assetReaderStyle = `
#easysch-asset-panel{position:fixed;right:0;top:41px;bottom:0;width:min(420px,85vw);box-sizing:border-box;background:var(--material-sidepane,Canvas);color:var(--fill-primary,CanvasText);border-left:var(--material-border,1px solid #aaa);z-index:10000;padding:12px;overflow:auto;font:menu;line-height:1.5}
#easysch-asset-panel.embedded-evidence{position:static;width:100%;border:0;padding:0;overflow:visible;background:transparent}
#easysch-asset-panel.embedded-evidence>header{display:none}
#easysch-asset-panel [hidden]{display:none!important}
#easysch-asset-panel button{display:inline-block!important;width:auto!important;height:auto!important;font:inherit;color:inherit;background:var(--material-button,ButtonFace);border:var(--material-border,1px solid #aaa);border-radius:4px;padding:4px 8px;margin:3px 3px 3px 0;cursor:pointer}
#easysch-asset-panel button:hover{background:var(--material-mix-quinary,#ddd)}
#easysch-asset-panel :is(button,input,select,summary):focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
#easysch-asset-panel img{display:block!important;width:100%;height:auto;max-height:210px;object-fit:contain;background:white;margin:8px 0}
#easysch-asset-panel article{border:1px solid var(--fill-quinary,#d7dade);border-radius:10px;padding:12px;margin:12px 0;background:var(--material-background,Canvas)}
#easysch-asset-panel article:hover{background:var(--material-mix-quinary,#f4f5f6);border-color:var(--fill-tertiary,#aeb5bd)}
#easysch-asset-panel .asset-preview-trigger{cursor:zoom-in;border-radius:6px;transition:filter .15s ease,transform .15s ease}
#easysch-asset-panel .asset-preview-trigger:hover{filter:brightness(.94);transform:translateY(-1px)}
#easysch-asset-panel .asset-preview-trigger:focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
#easysch-asset-panel .asset-save-note{font-weight:600}
#easysch-asset-panel p{margin:6px 0}
#easysch-asset-panel summary{cursor:pointer;margin:6px 0}
#easysch-asset-panel :is(input,select){box-sizing:border-box;font:inherit;color:inherit;background:var(--material-sidepane,Canvas);border:var(--material-border,1px solid #aaa);border-radius:4px;padding:5px}
#easysch-asset-panel input::placeholder{color:var(--fill-secondary,GrayText);opacity:1}
#easysch-asset-panel input[type=search]{width:100%;margin:8px 0}
#easysch-asset-panel header{display:flex;align-items:center;justify-content:space-between}
#easysch-asset-panel .asset-chain{font-size:11px;color:var(--fill-secondary,GrayText);border-top:1px solid var(--fill-quinary,#ddd);padding-top:8px}
#easysch-asset-panel .asset-error{color:var(--accent-red,#b43428);font-size:12px}
#easysch-asset-panel .asset-explanation{font-size:13px;line-height:1.65}
#easysch-asset-panel .asset-muted{color:var(--fill-secondary,GrayText);font-size:11px}
.easysch-image-preview{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;box-sizing:border-box;padding:28px;background:rgba(18,23,31,.72);backdrop-filter:blur(5px);cursor:zoom-out}
.easysch-image-preview-content{display:flex;flex-direction:column;max-width:min(94vw,1280px);max-height:94vh;min-width:min(360px,90vw);overflow:hidden;border-radius:12px;background:var(--material-sidepane,Canvas);color:var(--fill-primary,CanvasText);box-shadow:0 18px 52px rgba(0,0,0,.35);cursor:default;font:menu}
.easysch-image-preview-heading,.easysch-image-preview-content footer{display:flex;align-items:center;gap:8px;padding:10px 14px}
.easysch-image-preview-heading{border-bottom:1px solid var(--fill-quinary,#d7dade)}
.easysch-image-preview-heading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.easysch-image-preview-content>img{display:block;max-width:100%;max-height:calc(94vh - 112px);width:auto;height:auto;object-fit:contain;align-self:center;cursor:zoom-out;background:white}
.easysch-image-preview-content footer{border-top:1px solid var(--fill-quinary,#d7dade)}
.easysch-image-preview-content footer span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fill-secondary,GrayText);font-size:12px}
.easysch-image-preview-content button{width:auto!important;min-width:0!important;height:auto!important;padding:4px 9px;border:1px solid var(--fill-quinary,#d7dade);border-radius:6px;background:var(--material-button,ButtonFace);color:inherit;font:inherit;cursor:pointer;white-space:nowrap}
.easysch-image-preview-content button:hover{background:var(--material-mix-quinary,#ddd)}
.easysch-image-preview-content button:focus-visible{outline:2px solid var(--accent-blue,Highlight);outline-offset:2px}
@media(min-width:1100px){body:has(#easysch-asset-panel) :is(#split-view,.split-view){inset-inline-end:420px!important}}
`;

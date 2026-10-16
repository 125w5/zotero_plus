/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Offline native services must not depend on a reader or workspace window.
describe('Background artifact service', function () {
 this.timeout(120000);
 const E = Zotero.Research;
 async function withoutInteractiveRuntime(callback, partialTimers = false) {
  const prior = {setTimeout: E.setTimeout, clearTimeout: E.clearTimeout,
   ownsSet: Object.prototype.hasOwnProperty.call(E, 'setTimeout'), ownsClear: Object.prototype.hasOwnProperty.call(E, 'clearTimeout')};
  const mainWindow = sinon.stub(Zotero, 'getMainWindow').returns(null);
  E.setTimeout = partialTimers ? () => assert.fail('Incomplete interactive timer pair must not be used') : undefined;
  E.clearTimeout = undefined;
  try { return await callback(); }
  finally {
   mainWindow.restore();
   if (prior.ownsSet) E.setTimeout = prior.setTimeout; else delete E.setTimeout;
   if (prior.ownsClear) E.clearTimeout = prior.clearTimeout; else delete E.clearTimeout;
  }
 }
 async function engineIsAvailable() {
  const command = Zotero.Prefs.get('extensions.easysch.engineNode', true), entry = Zotero.Prefs.get('extensions.easysch.engineEntry', true);
  return command && entry && await IOUtils.exists(command) && await IOUtils.exists(entry);
 }
 it('runs the real local engine without startup timers or a main window', async function () {
  if (!await engineIsAvailable()) { this.skip(); return; }
  const prompt = await withoutInteractiveRuntime(() => E.runArtifactEngine({operation: 'prompt'}));
  assert.isArray(prompt.sections); assert.isAbove(prompt.sections.length, 0); assert.isArray(prompt.tools);
 });
 it('uses a complete native timer pair when only one interactive timer exists', async function () {
  if (!await engineIsAvailable()) { this.skip(); return; }
  const prompt = await withoutInteractiveRuntime(() => E.runArtifactEngine({operation: 'prompt'}), true);
  assert.isArray(prompt.sections); assert.isAbove(prompt.sections.length, 0);
 });
 it('indexes a real PDF with cold attachment and parent metadata without a window or model request', async function () {
  if (!await engineIsAvailable()) { this.skip(); return; }
  const python = Zotero.Prefs.get('extensions.easysch.assetPython', true);
  if (!python || !await IOUtils.exists(python)) { this.skip(); return; }
  const pdfs = (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).filter(item => item.isPDFAttachment() && !item.deleted);
  await Promise.all(pdfs.map(item => item.loadDataType('itemData')));
  pdfs.sort((a, b) => Number(/World.Model/i.test(b.getField('title'))) - Number(/World.Model/i.test(a.getField('title'))));
  let source;
  for (const pdf of pdfs) { if (await pdf.fileExists()) { source = await pdf.getFilePathAsync(); break; } }
  if (!source) { this.skip(); return; }
  const title = 'Offline source metadata fixture', doi = '10.1000/offline-artifact-fixture';
  let paper = new Zotero.Item('journalArticle'), attachmentID;
  paper.setField('title', title); paper.setField('DOI', doi);
  paper.setCreators([{firstName: 'Metadata', lastName: 'Fixture', creatorType: 'author'}]);
  await paper.saveTx();
  const paperID = paper.id;
  try {
   const attachment = await Zotero.Attachments.importFromFile({file: source, parentItemID: paperID}); attachmentID = attachment.id;
   Zotero.Items.unload([attachmentID, paperID]);
   const coldAttachment = await Zotero.Items.getAsync(attachmentID);
   paper = await Zotero.Items.getAsync(paperID);
   assert.isFalse(!!coldAttachment._loaded.itemData, 'Attachment must start with unloaded itemData');
   assert.isFalse(!!paper._loaded.itemData, 'Parent must start with unloaded itemData');
   const provider = sinon.stub(E, 'requestProvider').rejects(Error('Offline index must not request a model'));
   try {
    await withoutInteractiveRuntime(async () => {
     const indexed = await E.assets.index(attachmentID, () => {});
     assert.isAbove(indexed.assets.length, 0, 'Real source PDF must supply at least one evidence region');
     assert.isTrue(indexed.assets.every(asset => asset.paperTitle === title && asset.doi === doi && asset.paperItemID === paperID));
     assert.isTrue(indexed.assets.every(asset => asset.authors === 'Fixture'));
     assert.isTrue(coldAttachment._loaded.itemData); assert.isTrue(paper._loaded.itemData);
     const image = indexed.assets.find(asset => asset.path);
     assert.exists(image); assert.match(await E.previewImage(image.path), /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
    });
    assert.isFalse(provider.called, 'Indexing and image preview are fully offline');
   }
   finally { provider.restore(); }
  }
  finally { if (attachmentID) E.assets.active.delete(attachmentID); await Zotero.Items.erase(paperID); }
 });
 it('encodes image bytes with standard base64 padding and MIME types without a window', async function () {
  const fixtures = [
   {extension: 'png', bytes: [251], expected: 'data:image/png;base64,+w=='},
   {extension: 'JPG', bytes: [251, 255], expected: 'data:image/jpeg;base64,+/8='},
   {extension: 'webp', bytes: [251, 255, 255], expected: 'data:image/webp;base64,+///'},
   {extension: 'png', bytes: [], expected: 'data:image/png;base64,'}
  ];
  await withoutInteractiveRuntime(async () => {
   for (const fixture of fixtures) {
    const path = PathUtils.join(Zotero.DataDirectory.dir, 'artifact-background-' + Zotero.Utilities.randomString(20) + '.' + fixture.extension);
    try {
     await IOUtils.write(path, new Uint8Array(fixture.bytes));
     assert.equal(await E.previewImage(path), fixture.expected);
    }
    finally { await IOUtils.remove(path, {ignoreAbsent: true}); }
   }
  });
 });
});

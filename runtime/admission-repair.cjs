'use strict'
const { createHash } = require('node:crypto')
const TAG = 'DSH_ADMISSION_CANCEL_RC4_1'
const originals = {
  'dsh-api-session-controller': 'a9801acb577b03053c5d5a3191ff555c5f1d791d0acddec113bea4511e33b386',
  'dsh-attachment': '9cd6c01a6cca9431f789be334afdfe4f5cf647224bb394cc0215056796520f58',
  'dsh-attachment-local': 'cd39685581b4573a453c6126f8ce73da0bf1257c378827ebb431d6d4064f7662',
}
const hash = text => createHash('sha256').update(text).digest('hex')
function transformRuntimePackage(name, source, helperImport = './admission-cancellation.cjs') {
  if (!originals[name] || hash(source) !== originals[name]) throw Error('Runtime repair refuses an unknown source: ' + name)
  const one = (before, after) => {
    if (source.split(before).length !== 2) throw Error('Runtime repair source contract changed: ' + name + ': ' + before.slice(0, 80))
    source = source.replace(before, after)
  }
  if (name === 'dsh-api-session-controller') {
    source = 'import { PromptAdmissions } from ' + JSON.stringify(helperImport) + ';\n' + source
    one('var SessionCommandController = class {', 'var SessionCommandController = class {\n\tpromptAdmissions = new PromptAdmissions(() => new RemoteError("gateway/cancelled", "Message preparation was cancelled.", {}));')
    one('async prompt(request, source) {', 'async prompt(request, source, callerSignal) {\n\t\tconst operation = this.promptAdmissions.begin(request.sessionId, callerSignal);\n\t\ttry {\n\t\toperation.check();')
    one('if (hasPromptRequest(agent, request.requestId)) return { accepted: true };', 'operation.check();\n\t\tif (hasPromptRequest(agent, request.requestId)) return { accepted: true };')
    one('const admit = async () => {', 'const admit = async () => {\n\t\t\toperation.check();')
    one('content: await this.ctx.attachments.admitPromptContent(admission.content),', 'content: await this.ctx.attachments.admitPromptContent(admission.content, operation.signal),')
    one('if (this.ctx.agents.get(agent.id) !== agent)', 'operation.check();\n\t\t\t\t\tif (this.ctx.agents.get(agent.id) !== agent)')
    one('if (error instanceof AttachmentError) throw new RemoteError("session/attachment-invalid", error.message, { reason: error.code });\n\t\t\t\tthrow new RemoteError("session/agent-busy", "prompt rejected",', 'operation.check();\n\t\t\t\tif (error instanceof AttachmentError) throw new RemoteError("session/attachment-invalid", error.message, { reason: error.code });\n\t\t\t\tthrow new RemoteError("session/agent-busy", "prompt rejected",')
    one('return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit();', 'return await (hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit());\n\t\t} finally { operation.dispose(); }')
    one('cancel(request) {\n\t\tconst agent = this.ctx.agents.get(request.sessionId);', 'cancel(request) {\n\t\tconst agent = this.ctx.agents.get(request.sessionId);\n\t\tif (agent === void 0 && this.promptAdmissions.has(request.sessionId)) { this.promptAdmissions.cancel(request.sessionId); return { accepted: true }; }')
    one('agent.cancel({ kind: "user" }, { keepInbox: true });', 'this.promptAdmissions.cancel(request.sessionId);\n\t\tagent.cancel({ kind: "user" }, { keepInbox: true });')
    one('return this.commands.prompt(request, source);', 'return this.commands.prompt(request, source, signal);')
  } else if (name === 'dsh-attachment') {
    one('async function admitEncodedImages(attachments, images) {\n\treturn attachments.saveImages(images.map(saveInput));', 'async function admitEncodedImages(attachments, images, signal) {\n\tsignal?.throwIfAborted();\n\treturn attachments.saveImages(images.map(image => { signal?.throwIfAborted(); return saveInput(image); }), signal);')
    one('async saveImages(inputs) {', 'async saveImages(inputs, signal) {\n\t\tsignal?.throwIfAborted();')
    one('for (const input of inputs) await this.validateImage(input);', 'for (const input of inputs) { signal?.throwIfAborted(); await this.validateImage(input, signal); }')
    one('for (const input of inputs) refs.push(await this.saveImage(input));', 'for (const input of inputs) { signal?.throwIfAborted(); refs.push(await this.saveImage(input, signal)); }')
    one('async admitPromptContent(content) {', 'async admitPromptContent(content, signal) {\n\t\tsignal?.throwIfAborted();')
    one('const refs = await admitEncodedImages(this, content.filter((part) => part.type === "image"));', 'const refs = await admitEncodedImages(this, content.filter((part) => part.type === "image"), signal);\n\t\tsignal?.throwIfAborted();')
  } else {
    one('async function validateImageFile(input, limits, policy) {\n\tawait prepareImageFile(input, limits, policy);', 'async function validateImageFile(input, limits, policy, signal) {\n\tawait prepareImageFile(input, limits, policy, signal);')
    one('async function prepareImageFile(input, limits, policy) {', 'async function prepareImageFile(input, limits, policy, signal) {\n\tsignal?.throwIfAborted();')
    one('const detected = await inspectMetadata(input.data, input.mediaType, limits);', 'const detected = await inspectMetadata(input.data, input.mediaType, limits);\n\tsignal?.throwIfAborted();')
    one('const normalized = await normalizeImage(input.data, detected, policy);', 'const normalized = await normalizeImage(input.data, detected, policy);\n\tsignal?.throwIfAborted();')
    one('async function commitPreparedImageFile(root, prepared) {', 'async function commitPreparedImageFile(root, prepared, signal) {\n\tsignal?.throwIfAborted();')
    one('await publishImmutableObject(root, normalizedImagePath(root, prepared.ref), normalized, sha256);', 'await publishImmutableObject(root, normalizedImagePath(root, prepared.ref), normalized, sha256, signal);')
    one('async function publishImmutableObject(root, target, data, sha256) {', 'async function publishImmutableObject(root, target, data, sha256, signal) {\n\tsignal?.throwIfAborted();')
    one('\t})());\n\tif (staged.sha256 !== sha256)', '\t})(), signal);\n\tif (staged.sha256 !== sha256)')
    one('async function publishStagedObject(root, target, staged) {', 'async function publishStagedObject(root, target, staged, signal) {')
    one('await ensureDurableDirectory(parent, staged.boundary);\n\t\ttry {', 'signal?.throwIfAborted();\n\t\tawait ensureDurableDirectory(parent, staged.boundary);\n\t\tsignal?.throwIfAborted();\n\t\ttry {')
    // Once link succeeds, finish chmod/fsync/unlink atomically; cancellation must
    // not leave a published incomplete object. The prompt checks again before enqueue.
    const publications = 'await publishStagedObject(root, target, staged);'
    if (source.split(publications).length !== 3) throw Error('Unexpected publication call count')
    source = source.replaceAll(publications, 'await publishStagedObject(root, target, staged, signal);')
    one('await removeTemporary(staged.path);\n\t\tif (error instanceof AttachmentError) throw error;', 'await removeTemporary(staged.path);\n\t\tif (error instanceof AttachmentError || signal?.aborted === true) throw error;')
    one('async validateImage(input) {\n\t\tawait this.compression.run(() => validateImageFile(input, this.imageLimits, this.normalizationPolicy));', 'async validateImage(input, signal) {\n\t\tawait this.compression.run(() => validateImageFile(input, this.imageLimits, this.normalizationPolicy, signal));')
    one('async saveImages(inputs) {\n\t\tthis.validateImageBatch(inputs);\n\t\tconst prepared = await Promise.all(inputs.map((input) => this.compression.run(() => prepareImageFile(input, this.imageLimits, this.normalizationPolicy))));', 'async saveImages(inputs, signal) {\n\t\tsignal?.throwIfAborted();\n\t\tthis.validateImageBatch(inputs);\n\t\tconst results = await Promise.allSettled(inputs.map((input) => this.compression.run(() => prepareImageFile(input, this.imageLimits, this.normalizationPolicy, signal))));\n\t\tsignal?.throwIfAborted();\n\t\tconst rejected = results.find(result => result.status === "rejected");\n\t\tif (rejected) throw rejected.reason;\n\t\tconst prepared = results.map(result => result.value);')
    one('for (const image of prepared) refs.push(await commitPreparedImageFile(this.root, image));', 'for (const image of prepared) refs.push(await commitPreparedImageFile(this.root, image, signal));')
    one('async saveImage(input) {\n\t\tconst prepared = await this.compression.run(() => prepareImageFile(input, this.imageLimits, this.normalizationPolicy));\n\t\treturn commitPreparedImageFile(this.root, prepared);', 'async saveImage(input, signal) {\n\t\tconst prepared = await this.compression.run(() => prepareImageFile(input, this.imageLimits, this.normalizationPolicy, signal));\n\t\treturn commitPreparedImageFile(this.root, prepared, signal);')
  }
  return '// ' + TAG + '\n' + source
}
exports.transformRuntimePackage = transformRuntimePackage
exports.originalHashes = originals
exports.repairTag = TAG
exports.hash = hash

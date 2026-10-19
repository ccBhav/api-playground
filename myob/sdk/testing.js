const { createMockMyob } = require("./src/testing/mock");
const { createFactories } = require("./src/testing/factories");

/** @typedef {import("./src/testing/mock").MyobMock} MyobMock */
/** @typedef {import("./src/testing/mock").MockHandlers} MockHandlers */
/** @typedef {import("./src/testing/mock").MockRequest} MockRequest */
/** @typedef {import("./src/testing/mock").MockErrorBody} MockErrorBody */
/** @typedef {import("./src/testing/mock").CreateMockMyobOptions} CreateMockMyobOptions */
/** @typedef {import("./src/testing/factories").MyobFactories} MyobFactories */

module.exports = { createMockMyob, createFactories };

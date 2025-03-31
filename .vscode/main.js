
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/api.global.d.ts" />
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/vscode.global.d.ts" />
//  @ts-check
//  API: https://code.visualstudio.com/api/references/vscode-api

function activate(_context) {
   output("clear");

   const git = extensions.getExtension("vscode.git").exports.getAPI(1);



   println(git.repositories);
   println(git.repositories);
   println(git.repositories);
}

function deactivate() { }

module.exports = { activate, deactivate }

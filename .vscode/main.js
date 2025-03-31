
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/api.global.d.ts" />
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/vscode.global.d.ts" />
//  @ts-check
//  API: https://code.visualstudio.com/api/references/vscode-api

function activate(_context) {
   output("clear");

   const git = extensions.getExtension("vscode.git").exports.getAPI(1);

   const repo = git.repositories[0];

   println(repo.state.workingTreeChanges);
   println(repo.state.mergeChanges);
   println(repo.state.indexChanges);

   const changes = [
      ...repo.state.workingTreeChanges,
      ...repo.state.mergeChanges,
      ...repo.state.indexChanges,
   ];

   println(changes)
}

function deactivate() { }

module.exports = { activate, deactivate }

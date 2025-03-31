
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/api.global.d.ts" />
/// <reference path="c:/Users/Administrator/.vscode-insiders/extensions/nur.script-0.2.1/@types/vscode.global.d.ts" />
/// <reference path="A:/Programming/JavaScript/gitdoc/node_modules/.pnpm/@types+minimatch@3.0.5/node_modules/@types/minimatch/index.d.ts" />

const { match } = require("minimatch");
/* const { matchesGlobPath } = require("path");
const { matchesGlobPosix } = require("posix");
const { matchesGlobWin } = require("win32");
 */
//  @ts-check
//  API: https://code.visualstudio.com/api/references/vscode-api

function activate(_context) {
   /*    output("clear");

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

      const changedUris = changes
         .map((change) => change.uri);

      println(changedUris) */
   let hay = "a:\\Programming\\JavaScript\\Proxmox_VM_Viewer\\bla.testfile";
   let needle = ".testfile"
   println(match(hay, needle))
   println(matchesGlobPath(hay, needle))
   println(matchesGlobPosix(hay, needle))
   println(matchesGlobWin(hay, needle))
}

function deactivate() { }

module.exports = { activate, deactivate }

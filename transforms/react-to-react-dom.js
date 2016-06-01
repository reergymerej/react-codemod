/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 */

'use strict';

var CORE_PROPERTIES = [
  'Children',
  'Component',
  'createElement',
  'cloneElement',
  'isValidElement',
  'PropTypes',
  'createClass',
  'createFactory',
  'createMixin',
  'DOM',
  '__spread',
];

var DOM_PROPERTIES = [
  'findDOMNode',
  'render',
  'unmountComponentAtNode',
  'unstable_batchedUpdates',
  'unstable_renderSubtreeIntoContainer',
];

var DOM_SERVER_PROPERTIES = [
  'renderToString',
  'renderToStaticMarkup',
];

function reportError(node, error) {
  throw new Error(
    `At ${node.loc.start.line}:${node.loc.start.column}: ${error}`
  );
}

function isRequire(path, moduleName) {
  return (
    path.value.type === 'CallExpression' &&
    path.value.callee.type === 'Identifier' &&
    path.value.callee.name === 'require' &&
    path.value.arguments.length === 1 &&
    path.value.arguments[0].type === 'Literal' &&
    path.value.arguments[0].value === moduleName
  );
}

function getCoreRequireDeclarator(nodePath) {
  let coreRequireDeclarator;

  if (nodePath.parent.value.type === 'VariableDeclarator') {
    if (nodePath.parent.value.id.type === 'ObjectPattern') {
      var pattern = nodePath.parent.value.id;
      var all = pattern.properties.every(function(prop) {
        return (prop.key.type === 'Identifier')
          && CORE_PROPERTIES.indexOf(name) !== -1;
      });

      if (all) {
        // var {PropTypes} = require('React'); so leave alone
        return coreRequireDeclarator;
      }
    }

    coreRequireDeclarator = nodePath.parent;

  } else if (nodePath.parent.value.type === 'AssignmentExpression') {

    const name = nodePath.parent.value.left.name;
    const scope = nodePath.scope.lookup(name);
    const reactBindings = scope.getBindings()[name];
    coreRequireDeclarator = reactBindings[0].parent;
  }

  return coreRequireDeclarator;
}

function getNameForCoreAssignmentExpression(nodePath) {
  return nodePath.parent.value.left.name;
}

function getNameForCoreVariableDeclarator(nodePath) {
  return nodePath.parent.value.id.name;
}

function canReuseDomDeclaration(scope, file) {
  if (scope.declares('ReactDOM')) {
    console.log('Using existing ReactDOM var in ' + file.path);
    return true;
  }
  return false;
}

function canReuseDomServer(scope, file) {
  if (scope.declares('ReactDOMServer')) {
    console.log('Using existing ReactDOMServer var in ' + file.path);
    return true;
  }
  return false;
}

module.exports = function(file, api) {
  var j = api.jscodeshift;
  var root = j(file.source);

  [
    ['React', 'ReactDOM', 'ReactDOMServer'],
    ['react', 'react-dom', 'react-dom/server'],
  ].forEach(function(pair) {
    var coreModuleName = pair[0];
    var domModuleName = pair[1];
    var domServerModuleName = pair[2];

    var domAlreadyDeclared = false;
    var domServerAlreadyDeclared = false;

    var coreRequireDeclarator;

    root
      .find(j.CallExpression)
      .filter(p => isRequire(p, coreModuleName))
      .forEach(p => {


        var name, scope;
        if (p.parent.value.type === 'VariableDeclarator') {
          if (p.parent.value.id.type === 'ObjectPattern') {
            var pattern = p.parent.value.id;
            var all = pattern.properties.every(function(prop) {
              if (prop.key.type === 'Identifier') {
                name = prop.key.name;
                return CORE_PROPERTIES.indexOf(name) !== -1;
              }
              return false;
            });

            if (all) {
              // var {PropTypes} = require('React'); so leave alone
              return;
            }
          }

          // check for errors ----------
          if (coreRequireDeclarator) {
            reportError(
              p.value,
              'Multiple declarations of React'
            );
          }

          if (p.parent.value.id.type !== 'Identifier') {
            reportError(
              p.value,
              'Unexpected destructuring in require of ' + coreModuleName
            );
          }

          // 0. get name and scope
          name = getNameForCoreVariableDeclarator(p);
          scope = p.scope.lookup(name);

          // 1. find core require declarator
          coreRequireDeclarator = getCoreRequireDeclarator(p);

          // 2. get existing declarations to reuse
          domAlreadyDeclared = canReuseDomDeclaration(scope, file);
          domServerAlreadyDeclared = canReuseDomServer(scope, file);

        } else if (p.parent.value.type === 'AssignmentExpression') {
          if (p.parent.value.left.type !== 'Identifier') {
            reportError(
              p.value,
              'Unexpected destructuring in require of ' + coreModuleName
            );
          }

          // 0. get name and scope
          name = getNameForCoreAssignmentExpression(p);
          scope = p.scope.lookup(name);

          var reactBindings = scope.getBindings()[name];
          if (reactBindings.length !== 1) {
            throw new Error(
              'Unexpected number of bindings: ' + reactBindings.length
            );
          }

          // 1. find core require declarator
          coreRequireDeclarator = getCoreRequireDeclarator(p);

          if (coreRequireDeclarator.value.init &&
              !isRequire(coreRequireDeclarator.get('init'), coreModuleName)) {
            reportError(
              coreRequireDeclarator.value,
              'Unexpected initialization of ' + coreModuleName
            );
          }

          // 2. get existing declarations to reuse
          domAlreadyDeclared = canReuseDomDeclaration(scope, file);
          domServerAlreadyDeclared = canReuseDomServer(scope, file);
        }
      });

    if (!coreRequireDeclarator) {
      return;
    }

    if (!domAlreadyDeclared &&
        root.find(j.Identifier, {name: 'ReactDOM'}).size() > 0) {
      throw new Error(
        'ReactDOM is already defined in a different scope than React'
      );
    }
    if (!domServerAlreadyDeclared &&
        root.find(j.Identifier, {name: 'ReactDOMServer'}).size() > 0) {
      throw new Error(
        'ReactDOMServer is already defined in a different scope than React'
      );
    }

    var coreName = coreRequireDeclarator.value.id.name;

    var processed = new Set();
    var requireAssignments = [];
    var coreUses = 0;
    var domUses = 0;
    var domServerUses = 0;

    root
      .find(j.Identifier, {name: coreName})
      .forEach(p => {
        if (processed.has(p.value)) {
          // https://github.com/facebook/jscodeshift/issues/36
          return;
        }
        processed.add(p.value);
        if (p.parent.value.type === 'MemberExpression' ||
            p.parent.value.type === 'QualifiedTypeIdentifier') {
          var left;
          var right;
          if (p.parent.value.type === 'MemberExpression') {
            left = p.parent.value.object;
            right = p.parent.value.property;
          } else {
            left = p.parent.value.qualification;
            right = p.parent.value.id;
          }
          if (left === p.value) {
            // React.foo (or React[foo])
            if (right.type === 'Identifier') {
              var name = right.name;
              if (CORE_PROPERTIES.indexOf(name) !== -1) {
                coreUses++;
              } else if (DOM_PROPERTIES.indexOf(name) !== -1) {
                domUses++;
                j(p).replaceWith(j.identifier('ReactDOM'));
              } else if (DOM_SERVER_PROPERTIES.indexOf(name) !== -1) {
                domServerUses++;
                j(p).replaceWith(j.identifier('ReactDOMServer'));
              } else {
                throw new Error('Unknown property React.' + name);
              }
            }
          } else if (right === p.value) {
            // foo.React, no need to transform
          } else {
            throw new Error('unimplemented');
          }
        } else if (p.parent.value.type === 'VariableDeclarator') {
          if (p.parent.value.id === p.value) {
            // var React = ...;
          } else if (p.parent.value.init === p.value) {
            // var ... = React;
            var pattern = p.parent.value.id;
            if (pattern.type === 'ObjectPattern') {
              // var {PropTypes} = React;
              // Most of these cases will just be looking at {PropTypes} so this
              // is usually a no-op.
              var coreProperties = [];
              var domProperties = [];
              pattern.properties.forEach(function(prop) {
                if (prop.key.type === 'Identifier') {
                  var key = prop.key.name;
                  if (CORE_PROPERTIES.indexOf(key) !== -1) {
                    coreProperties.push(prop);
                  } else if (DOM_PROPERTIES.indexOf(key) !== -1) {
                    domProperties.push(prop);
                  } else {
                    throw new Error(
                      'Unknown property React.' + key + ' while destructuring'
                    );
                  }
                } else {
                  throw new Error('unimplemented');
                }
              });
              var domDeclarator = j.variableDeclarator(
                j.objectPattern(domProperties),
                j.identifier('ReactDOM')
              );
              if (coreProperties.length && !domProperties.length) {
                // nothing to do
                coreUses++;
              } else if (domProperties.length && !coreProperties.length) {
                domUses++;
                j(p.parent).replaceWith(domDeclarator);
              } else {
                coreUses++;
                domUses++;
                var decl = j(p).closest(j.VariableDeclaration);
                decl.insertAfter(j.variableDeclaration(
                  decl.get().value.kind,
                  [domDeclarator]
                ));
              }
            } else {
              throw new Error('unimplemented');
            }
          } else {
            throw new Error('unimplemented');
          }
        } else if (p.parent.value.type === 'AssignmentExpression') {
          if (p.parent.value.left === p.value) {
            if (isRequire(p.parent.get('right'), coreModuleName)) {
              requireAssignments.push(p.parent);
            } else {
              reportError(
                p.parent.value,
                'Unexpected assignment to ' + coreModuleName
              );
            }
          } else {
            throw new Error('unimplemented');
          }
        } else {
          reportError(p.value, 'unimplemented ' + p.parent.value.type);
        }
      });

    coreUses += root.find(j.JSXElement).size();

    function insertRequire(name, path) {
      var req = j.callExpression(
        j.identifier('require'),
        [j.literal(path)]
      );
      requireAssignments.forEach(function(requireAssignment) {
        requireAssignment.parent.insertAfter(
          j.expressionStatement(
            j.assignmentExpression('=', j.identifier(name), req)
          )
        );
      });
      coreRequireDeclarator.parent.insertAfter(j.variableDeclaration(
        coreRequireDeclarator.parent.value.kind,
        [j.variableDeclarator(
          j.identifier(name),
          coreRequireDeclarator.value.init ? req : null
        )]
      ));
    }

    if (domServerUses > 0 && !domServerAlreadyDeclared) {
      insertRequire('ReactDOMServer', domServerModuleName);
    }
    if (domUses > 0 && !domAlreadyDeclared) {
      insertRequire('ReactDOM', domModuleName);
    }
    if ((domUses > 0 || domServerUses > 0) && coreUses === 0) {
      j(coreRequireDeclarator).remove();
      requireAssignments.forEach(r => j(r).remove());
    }
  });

  return root.toSource({quote: 'single'});
};

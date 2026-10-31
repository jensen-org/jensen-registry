(label) @function
(instruction kind: (word) @_mnemonic (#match? @_mnemonic "^(j[a-z]+|b[a-z]*|call|bl|bx|blx|ret|loop[a-z]*)$")) @branch

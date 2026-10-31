(function_definition) @function
(if_statement) @branch
(elif_clause) @branch
(case_item) @branch
(ternary_expression) @branch
(for_statement) @loop
(c_style_for_statement) @loop
(while_statement) @loop
(list ["&&" "||"]) @boolean
(binary_expression operator: ["&&" "||"]) @boolean
(if_statement) @nesting
(for_statement) @nesting
(c_style_for_statement) @nesting
(while_statement) @nesting
(case_statement) @nesting
(subshell) @nesting

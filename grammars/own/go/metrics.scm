(function_declaration) @function
(method_declaration) @function
(func_literal) @function
(function_declaration parameters: (parameter_list (parameter_declaration name: (identifier) @parameter)))
(method_declaration parameters: (parameter_list (parameter_declaration name: (identifier) @parameter)))
(func_literal parameters: (parameter_list (parameter_declaration name: (identifier) @parameter)))
(if_statement) @branch
(expression_case) @branch
(default_case) @branch
(type_case) @branch
(communication_case) @branch
(for_statement) @loop
(binary_expression operator: ["&&" "||"]) @boolean
(if_statement) @nesting
(for_statement) @nesting
(expression_switch_statement) @nesting
(type_switch_statement) @nesting
(select_statement) @nesting

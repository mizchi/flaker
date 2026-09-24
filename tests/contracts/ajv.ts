// tests/contracts/ajv.ts
import Ajv2020Module from "ajv/dist/2020.js";

// ajv ships CJS; under ESM the class is either the module or its default.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (
  opts: Record<string, unknown>,
) => { compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown } };

export function validator(schema: object) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  return (data: unknown): string | null => (validate(data) ? null : JSON.stringify(validate.errors));
}

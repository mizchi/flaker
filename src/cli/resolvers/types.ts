export interface DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[] | Promise<string[]>;
}

import './metadata.js';

export { ServiceCollection } from './collection.js';
export {
  getServiceOptions,
  Inject,
  type InjectOptions,
  isService,
  Optional,
  Service,
  type ServiceOptions,
} from './decorators.js';
export {
  type ClassProvider,
  type DescriptorKind,
  describe,
  type ExistingProvider,
  type FactoryProvider,
  type Implementation,
  normalizeProvider,
  type Provider,
  type ServiceDescriptor,
  type ValueProvider,
} from './descriptor.js';
export {
  CaptiveDependencyError,
  CircularDependencyError,
  DiError,
  InvalidDescriptorError,
  MissingServiceError,
  ProviderDisposedError,
  ScopedFromRootError,
  UnresolvableParameterError,
} from './errors.js';
export {
  alias,
  type BindingOptions,
  factory,
  scoped,
  singleton,
  transient,
  value,
} from './helpers.js';
export {
  defineMetadata,
  getMetadata,
  getOwnMetadata,
  hasMetadata,
  hasOwnMetadata,
  installReflectShim,
} from './metadata.js';
export { buildServiceProvider, ServiceProvider, type ServiceProviderOptions } from './provider.js';
export {
  getConstructorParameters,
  type InjectEntry,
  type InjectEntryObject,
  type ParameterInfo,
} from './reflection.js';
export {
  type Dependencies,
  type ResolvedDependencies,
  ServiceDefinition,
  type ServiceDefinitionOptions,
  type ServiceOf,
  service,
} from './service.js';
export {
  type AbstractConstructor,
  type Constructor,
  type Factory,
  InjectionToken,
  isConstructor,
  type Lifetime,
  type Resolved,
  type Token,
  tokenName,
} from './types.js';

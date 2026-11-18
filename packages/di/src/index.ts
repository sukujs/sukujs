import './metadata.js';

export { ServiceCollection } from './collection';
export {
  getServiceOptions,
  Inject,
  type InjectOptions,
  isService,
  Optional,
  Service,
  type ServiceOptions,
} from './decorators';
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
} from './descriptor';
export {
  CaptiveDependencyError,
  CircularDependencyError,
  DiError,
  InvalidDescriptorError,
  MissingServiceError,
  ProviderDisposedError,
  ScopedFromRootError,
  UnresolvableParameterError,
} from './errors';
export {
  alias,
  type BindingOptions,
  factory,
  scoped,
  singleton,
  transient,
  value,
} from './helpers';
export {
  defineMetadata,
  getMetadata,
  getOwnMetadata,
  hasMetadata,
  hasOwnMetadata,
  installReflectShim,
} from './metadata';
export { buildServiceProvider, ServiceProvider, type ServiceProviderOptions } from './provider';
export {
  getConstructorParameters,
  type InjectEntry,
  type InjectEntryObject,
  type ParameterInfo,
} from './reflection';
export {
  type Dependencies,
  type ResolvedDependencies,
  ServiceDefinition,
  type ServiceDefinitionOptions,
  type ServiceOf,
  service,
} from './service';
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
} from './types';

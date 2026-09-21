// Loading this config throws — exercises the "one config fails, the others are reported" path.
throw new Error('boom: this config cannot be loaded');

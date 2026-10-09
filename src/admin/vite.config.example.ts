import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig): UserConfig => {
  // Important: always return the modified config
  return mergeConfig(config, {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  });
};

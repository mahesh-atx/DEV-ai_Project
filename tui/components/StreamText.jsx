import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { THEME } from '../constants.js';

const StreamText = ({ text, onComplete }) => {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i));
      i++;
      if (i >= text.length) {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, 10);
    return () => clearInterval(interval);
  }, [text]);

  return <Text color={THEME.text}>{displayed}</Text>;
};

export default StreamText;

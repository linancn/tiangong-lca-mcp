const cleanObject = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj
      .map((v) => (typeof v === 'object' ? cleanObject(v) : v))
      .filter((v) => v !== undefined && v !== null);
  } else if (typeof obj === 'object' && obj !== null) {
    const cleanedObj = Object.entries(obj)
      .map(([k, v]) => [k, cleanObject(v)])
      .reduce((acc, [k, v]) => {
        if (
          v !== undefined &&
          v !== null &&
          (typeof v !== 'object' || (typeof v === 'object' && Object.keys(v).length > 0))
        ) {
          acc[k] = v;
        }
        return acc;
      }, {} as any);
    return cleanedObj;
  }
  return obj;
};

export default cleanObject;

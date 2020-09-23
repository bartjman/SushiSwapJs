class Decoder {
    constructor(web3) {
        this.web3 = web3;
        this.state = {
            savedABIs: [],
            methodIDs: {},
        };
    }

    getABIs() {
        return this.state.savedABIs;
    }

    typeToString(input) {
        if (input.type === "tuple") {
            return "(" + input.components.map(this.typeToString).join(",") + ")";
        }
        return input.type;
    }

    addABI(abiArray) {
        let sha3 = this.web3.utils.sha3;
        let self = this;
        if (Array.isArray(abiArray)) {
            // Iterate new abi to generate method id"s
            abiArray.map(function (abi) {
                if (abi.name) {
                    const signature = sha3(
                        abi.name +
                        "(" +
                        abi.inputs
                            .map(self.typeToString)
                            .join(",") +
                        ")"
                    );
                    if (abi.type === "event") {
                        self.state.methodIDs[signature.slice(2)] = abi;
                    } else {
                        self.state.methodIDs[signature.slice(2, 10)] = abi;
                    }
                }
            });

            this.state.savedABIs = this.state.savedABIs.concat(abiArray);
        } else {
            throw new Error("Expected ABI array, got " + typeof abiArray);
        }
    }

    removeABI(abiArray) {
        if (Array.isArray(abiArray)) {
            // Iterate new abi to generate method id"s
            abiArray.map(function (abi) {
                if (abi.name) {
                    const signature = sha3(
                        abi.name +
                        "(" +
                        abi.inputs
                            .map(function (input) {
                                return input.type;
                            })
                            .join(",") +
                        ")"
                    );
                    if (abi.type === "event") {
                        if (this.state.methodIDs[signature.slice(2)]) {
                            delete this.state.methodIDs[signature.slice(2)];
                        }
                    } else {
                        if (this.state.methodIDs[signature.slice(2, 10)]) {
                            delete this.state.methodIDs[signature.slice(2, 10)];
                        }
                    }
                }
            });
        } else {
            throw new Error("Expected ABI array, got " + typeof abiArray);
        }
    }

    getMethodIDs() {
        return this.state.methodIDs;
    }

    decodeMethod(data) {
        var BN = this.web3.utils.BN;
        const methodID = data.slice(2, 10);
        const abiItem = this.state.methodIDs[methodID];
        if (abiItem) {
            let decoded = this.web3.eth.abi.decodeParameters(abiItem.inputs, data.slice(10));

            let retData = {
                name: abiItem.name,
                params: [],
            };

            for (let i = 0; i < decoded.__length__; i++) {
                let param = decoded[i];
                let parsedParam = param;
                const isUint = abiItem.inputs[i].type.indexOf("uint") === 0;
                const isInt = abiItem.inputs[i].type.indexOf("int") === 0;
                const isAddress = abiItem.inputs[i].type.indexOf("address") === 0;

                if (isUint || isInt) {
                    const isArray = Array.isArray(param);

                    if (isArray) {
                        parsedParam = param.map(val => new BN(val).toString());
                    } else {
                        parsedParam = new BN(param).toString();
                    }
                }

                // Addresses returned by web3 are randomly cased so we need to standardize and lowercase all
                if (isAddress) {
                    const isArray = Array.isArray(param);

                    if (isArray) {
                        parsedParam = param.map(_ => _.toLowerCase());
                    } else {
                        parsedParam = param.toLowerCase();
                    }
                }

                retData.params.push({
                    name: abiItem.inputs[i].name,
                    value: parsedParam,
                    type: abiItem.inputs[i].type,
                });
            }

            return retData;
        }
    }

    decodeLogs(logs) {
        var BN = this.web3.utils.BN;

        return logs.filter(log => log.topics.length > 0).map((logItem) => {
            const methodID = logItem.topics[0].slice(2);
            const method = this.state.methodIDs[methodID];
            if (method) {
                const logData = logItem.data;
                let decodedParams = [];
                let dataIndex = 0;
                let topicsIndex = 1;

                let dataTypes = [];
                method.inputs.map(function (input) {
                    if (!input.indexed) {
                        dataTypes.push(input.type);
                    }
                });

                const decodedData = this.web3.eth.abi.decodeParameters(
                    dataTypes,
                    logData.slice(2)
                );

                // Loop topic and data to get the params
                method.inputs.map(function (param) {
                    let decodedP = {
                        name: param.name,
                        type: param.type,
                    };

                    if (param.indexed) {
                        decodedP.value = logItem.topics[topicsIndex];
                        topicsIndex++;
                    } else {
                        decodedP.value = decodedData[dataIndex];
                        dataIndex++;
                    }

                    if (param.type === "address") {
                        decodedP.value = decodedP.value.toLowerCase();
                        // 42 because len(0x) + 40
                        if (decodedP.value.length > 42) {
                            let toRemove = decodedP.value.length - 42;
                            let temp = decodedP.value.split("");
                            temp.splice(2, toRemove);
                            decodedP.value = temp.join("");
                        }
                    }

                    if (
                        param.type === "uint256" ||
                        param.type === "uint8" ||
                        param.type === "int"
                    ) {
                        // ensure to remove leading 0x for hex numbers
                        if (typeof decodedP.value === "string" && decodedP.value.startsWith("0x")) {
                            decodedP.value = new BN(decodedP.value.slice(2), 16).toString(10);
                        } else {
                            decodedP.value = new BN(decodedP.value).toString(10);
                        }

                    }

                    decodedParams.push(decodedP);
                });

                return {
                    name: method.name,
                    events: decodedParams,
                    address: logItem.address,
                };
            }
        });
    }

    decodeLog(log) {
        return this.decodeLogs([log])[0];
    }
}
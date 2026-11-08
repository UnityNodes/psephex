// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AiOracle} from "../src/AiOracle.sol";

contract Deploy is Script {
    function run() external returns (AiOracle deployed) {
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        vm.startBroadcast();
        deployed = new AiOracle(oracle, owner);
        vm.stopBroadcast();
        console.log("AiOracle", address(deployed));
        console.log("oracle", oracle);
        console.log("owner", owner);
    }
}

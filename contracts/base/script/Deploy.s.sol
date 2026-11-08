// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AiOracle} from "../src/AiOracle.sol";

contract Deploy is Script {
    function run() external returns (AiOracle deployed) {
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 fee = vm.envUint("FEE_WEI");
        vm.startBroadcast();
        deployed = new AiOracle(oracle, owner, fee);
        vm.stopBroadcast();
        console.log("AiOracle", address(deployed));
        console.log("oracle", oracle);
        console.log("owner", owner);
        console.log("fee", fee);
    }
}
